//! The 24/7-safe live pipeline: producer, encoder, then one independent relay per destination.
//! The encoder can restart without dropping any RTMP connection, each relay reconnects with
//! exponential backoff, and every buffer is bounded.

use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use bytes::Bytes;
use cricstudio_engine::js::now_ms;
use cricstudio_engine::media::{encoder_args, prefer_video_copy, relay_args, rtmp_url};
use regex::{Regex, RegexBuilder};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{ChildStdin, Command};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::Notify;

use crate::config::Config;
use crate::state::{DestinationStatus, LiveStatus};

const MAX_RELAY_BACKLOG: usize = 12 * 1024 * 1024;
const MAX_ENCODER_BACKLOG: usize = 24 * 1024 * 1024;

static PROGRESS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"frame=\s*([0-9]+)\s+fps=\s*([0-9.]+)").expect("static regex"));
static SPEED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"speed=\s*([0-9.]+)x").expect("static regex"));
static RELAY_UP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"frame=\s*[0-9]+|size=\s*[0-9]+").expect("static regex"));
static ENC_ERR: LazyLock<Regex> = LazyLock::new(|| RegexBuilder::new("error|invalid|fail").case_insensitive(true).build().expect("static regex"));
static RELAY_ERR: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new("error|fail|refused|denied|timed out|invalid|broken|reset")
        .case_insensitive(true)
        .build()
        .expect("static regex")
});

#[derive(Clone, Debug)]
pub struct StreamTarget {
    pub id: String,
    pub platform: String,
    pub name: String,
    pub url: String,
    pub key: String,
}

#[derive(Debug)]
pub enum PipelineEvent {
    Status(LiveStatus),
    NeedRestart,
    Log(String),
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Encoder(u64),
    Relay(usize, u64),
}

enum Msg {
    Write(Bytes),
    Reset(Option<String>),
    Stop,
    Out(u64, Bytes),
    Line(Kind, String),
    Exit(Kind, String),
    SpawnFailed(Kind, String),
    RespawnEncoder,
    RespawnRelay(usize),
    Health,
}

/// A child's stdin fed through a byte-counted queue, so backlog can be measured and bounded.
struct Feed {
    tx: UnboundedSender<Bytes>,
    queued: Arc<AtomicUsize>,
}

impl Feed {
    fn new(mut stdin: ChildStdin) -> Self {
        let (tx, mut rx) = unbounded_channel::<Bytes>();
        let queued = Arc::new(AtomicUsize::new(0));
        let counter = queued.clone();
        tokio::spawn(async move {
            while let Some(buf) = rx.recv().await {
                let n = buf.len();
                let ok = stdin.write_all(&buf).await.is_ok();
                counter.fetch_sub(n, Ordering::SeqCst);
                if !ok {
                    break;
                }
            }
            let _ = stdin.shutdown().await;
        });
        Self { tx, queued }
    }

    fn write(&self, buf: Bytes) {
        self.queued.fetch_add(buf.len(), Ordering::SeqCst);
        if self.tx.send(buf.clone()).is_err() {
            self.queued.fetch_sub(buf.len(), Ordering::SeqCst);
        }
    }

    fn backlog(&self) -> usize {
        self.queued.load(Ordering::SeqCst)
    }
}

struct Proc {
    feed: Feed,
    kill: Arc<Notify>,
}

impl Proc {
    /// Close stdin, then force-kill after a grace period.
    fn retire(self, grace: Duration) {
        let kill = self.kill;
        drop(self.feed);
        tokio::spawn(async move {
            tokio::time::sleep(grace).await;
            kill.notify_one();
        });
    }
}

fn exit_reason(s: Result<ExitStatus, std::io::Error>) -> String {
    let Ok(status) = s else {
        return "Encoder exited (code null) — restarting".into();
    };
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = status.signal() {
            return if sig == 9 {
                "Encoder stalled or ran out of memory (killed) — restarting".into()
            } else {
                format!("Encoder stopped by signal {sig} (server instance shutting down) — restarting")
            };
        }
    }
    match status.code() {
        Some(c) => format!("Encoder exited (code {c}) — restarting"),
        None => "Encoder exited (code null) — restarting".into(),
    }
}

fn spawn_lines<R: AsyncRead + Unpin + Send + 'static>(mut r: R, kind: Kind, tx: UnboundedSender<Msg>) {
    tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        let mut pending = String::new();
        while let Ok(n) = r.read(&mut buf).await {
            if n == 0 {
                break;
            }
            pending.push_str(&String::from_utf8_lossy(&buf[..n]));
            while let Some(i) = pending.find(['\r', '\n']) {
                let line: String = pending.drain(..=i).collect();
                let line = line.trim();
                if !line.is_empty() && tx.send(Msg::Line(kind, line.to_string())).is_err() {
                    return;
                }
            }
        }
    });
}

fn start(ffmpeg: &str, args: &[String], kind: Kind, tx: &UnboundedSender<Msg>) -> Result<Proc, String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(if matches!(kind, Kind::Encoder(_)) { Stdio::piped() } else { Stdio::null() })
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // no console window
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    if let Some(err) = child.stderr.take() {
        spawn_lines(err, kind, tx.clone());
    }
    if let (Kind::Encoder(gen), Some(mut out)) = (kind, child.stdout.take()) {
        let out_tx = tx.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 64 * 1024];
            while let Ok(n) = out.read(&mut buf).await {
                if n == 0 || out_tx.send(Msg::Out(gen, Bytes::copy_from_slice(&buf[..n]))).is_err() {
                    break;
                }
            }
        });
    }
    let kill = Arc::new(Notify::new());
    let waiter = kill.clone();
    let exit_tx = tx.clone();
    tokio::spawn(async move {
        let status = tokio::select! {
            s = child.wait() => s,
            () = waiter.notified() => {
                let _ = child.start_kill();
                child.wait().await
            }
        };
        let _ = exit_tx.send(Msg::Exit(kind, exit_reason(status)));
    });
    Ok(Proc { feed: Feed::new(stdin), kill })
}

struct Relay {
    target: StreamTarget,
    proc: Option<Proc>,
    gen: u64,
    backoff: u64,
    live_since: f64,
    tail: Vec<String>,
}

fn push_tail(tail: &mut Vec<String>, line: String, max: usize) {
    tail.push(line);
    if tail.len() > max {
        tail.remove(0);
    }
}

struct Worker {
    cfg: Arc<Config>,
    tx: UnboundedSender<Msg>,
    events: UnboundedSender<PipelineEvent>,
    running: Arc<AtomicBool>,
    status: LiveStatus,
    relays: Vec<Relay>,
    encoder: Option<Proc>,
    enc_gen: u64,
    started_at: f64,
    last_ingest: f64,
    last_output: f64,
    enc_tail: Vec<String>,
    encoder_restarts: u32,
    enc_bytes: usize,
    video_copy: bool,
    awaiting_header: bool,
    bytes_in: u64,
    last_emit: f64,
}

impl Worker {
    fn stopped(&self) -> bool {
        !self.running.load(Ordering::SeqCst)
    }

    fn emit_status(&mut self, force: bool) {
        let now = now_ms();
        if !force && now - self.last_emit < 2000.0 {
            return;
        }
        self.last_emit = now;
        let secs = (now - self.status.started_at.unwrap_or(now)) / 1000.0;
        self.status.bitrate_kbps = (secs > 1.0).then(|| cricstudio_engine::js::round(self.bytes_in as f64 * 8.0 / 1000.0 / secs));
        let _ = self.events.send(PipelineEvent::Status(self.status.clone()));
    }

    fn log(&self, line: String) {
        let _ = self.events.send(PipelineEvent::Log(line));
    }

    fn spawn_encoder(&mut self) {
        let offset = if self.started_at != 0.0 { (now_ms() - self.started_at) / 1000.0 } else { 0.0 };
        let copy = self.video_copy && !self.cfg.encoder_x264;
        let args = encoder_args(offset, self.cfg.video_bitrate_kbps, self.cfg.audio_bitrate_kbps, &self.cfg.x264_preset, copy);
        self.enc_gen += 1;
        self.enc_bytes = 0;
        self.awaiting_header = true;
        match start(&self.cfg.ffmpeg_path, &args, Kind::Encoder(self.enc_gen), &self.tx) {
            Ok(p) => self.encoder = Some(p),
            Err(e) => {
                let _ = self.tx.send(Msg::SpawnFailed(Kind::Encoder(self.enc_gen), e));
            }
        }
    }

    fn spawn_relay(&mut self, i: usize) {
        if self.stopped() {
            return;
        }
        self.status.destinations[i].state = "connecting".into();
        let r = &mut self.relays[i];
        r.gen += 1;
        r.live_since = 0.0;
        let kind = Kind::Relay(i, r.gen);
        let args = relay_args(&rtmp_url(&r.target.url, &r.target.key));
        match start(&self.cfg.ffmpeg_path, &args, kind, &self.tx) {
            Ok(p) => r.proc = Some(p),
            Err(e) => {
                let _ = self.tx.send(Msg::SpawnFailed(kind, e));
            }
        }
        self.emit_status(true);
    }

    fn on_encoder_output(&mut self, gen: u64, buf: Bytes) {
        if gen != self.enc_gen {
            return;
        }
        self.last_output = now_ms();
        for i in 0..self.relays.len() {
            let Some(p) = &self.relays[i].proc else { continue };
            if p.feed.backlog() > MAX_RELAY_BACKLOG {
                p.kill.notify_one();
                let name = self.relays[i].target.name.clone();
                self.log(format!("[{name}] backlog overflow, reconnecting"));
                continue;
            }
            p.feed.write(buf.clone());
        }
    }

    fn on_encoder_line(&mut self, gen: u64, line: String) {
        if gen != self.enc_gen {
            return;
        }
        let progress = PROGRESS.captures(&line).and_then(|c| c[2].parse::<f64>().ok());
        let speed = SPEED.captures(&line).and_then(|c| c[1].parse::<f64>().ok());
        push_tail(&mut self.enc_tail, line, 20);
        if let Some(fps) = progress.filter(|_| !self.stopped()) {
            self.status.fps = Some(fps);
            self.status.speed = speed;
            if self.status.state == "starting" || self.status.state == "reconnecting" {
                self.status.state = "live".into();
                self.status.error = None;
                self.status.started_at.get_or_insert_with(now_ms);
                self.emit_status(true);
            }
        }
    }

    fn on_encoder_exit(&mut self, gen: u64, why: String) {
        if gen != self.enc_gen {
            return; // retired encoder, already replaced
        }
        self.encoder = None;
        if self.stopped() {
            return;
        }
        self.encoder_restarts += 1;
        self.status.reconnects = Some(self.encoder_restarts);
        self.status.state = "reconnecting".into();
        let err = self
            .enc_tail
            .iter()
            .rfind(|l| ENC_ERR.is_match(l))
            .map_or_else(String::new, |l| format!(". {l}"));
        self.status.error = Some(crate::speech::slice_units(&format!("{why}{err}"), 300));
        self.emit_status(true);
        let tx = self.tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(800)).await;
            let _ = tx.send(Msg::RespawnEncoder);
        });
    }

    fn on_relay_line(&mut self, i: usize, gen: u64, line: String) {
        if self.relays[i].gen != gen {
            return;
        }
        let up = RELAY_UP.is_match(&line);
        push_tail(&mut self.relays[i].tail, line, 12);
        if up && self.status.destinations[i].state != "live" {
            self.status.destinations[i].state = "live".into();
            self.status.destinations[i].error = None;
            self.relays[i].live_since = now_ms();
            self.emit_status(true);
        }
    }

    fn on_relay_exit(&mut self, i: usize, gen: u64) {
        if self.relays[i].gen != gen {
            return;
        }
        self.relays[i].proc = None;
        if self.stopped() {
            return;
        }
        let r = &mut self.relays[i];
        if r.live_since != 0.0 && now_ms() - r.live_since > 60_000.0 {
            r.backoff = 1000; // healthy for a minute
        }
        let error = r
            .tail
            .iter()
            .rfind(|l| RELAY_ERR.is_match(l))
            .or_else(|| r.tail.last())
            .map_or("Connection dropped", String::as_str);
        let error = crate::speech::slice_units(error, 200);
        let wait = r.backoff;
        r.backoff = (r.backoff * 2).min(30_000);
        let name = r.target.name.clone();
        let d = &mut self.status.destinations[i];
        d.state = "retrying".into();
        d.retries = Some(d.retries.unwrap_or(0) + 1);
        d.error = Some(error.clone());
        self.log(format!("[{name}] relay exited, reconnecting: {error}"));
        self.emit_status(true);
        let tx = self.tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(wait)).await;
            let _ = tx.send(Msg::RespawnRelay(i));
        });
    }

    /// The producer (re)started its recorder: the next chunk is a new container header.
    fn reset_ingest(&mut self, mime: Option<String>) {
        if self.stopped() {
            return;
        }
        let copy = mime.as_deref().map_or(self.video_copy, prefer_video_copy);
        let mode_changed = copy != self.video_copy;
        self.video_copy = copy;
        if self.enc_bytes == 0 && !mode_changed && self.encoder.is_some() {
            self.awaiting_header = false;
            return;
        }
        if let Some(old) = self.encoder.take() {
            old.retire(Duration::from_millis(1500));
        }
        self.spawn_encoder();
        self.awaiting_header = false;
    }

    fn write(&mut self, chunk: Bytes) {
        if self.stopped() {
            return;
        }
        self.last_ingest = now_ms();
        self.bytes_in += chunk.len() as u64;
        // mid-stream bytes would crash a fresh encoder: wait for a header
        if self.encoder.is_none() || self.awaiting_header {
            return;
        }
        if self.encoder.as_ref().is_some_and(|e| e.feed.backlog() > MAX_ENCODER_BACKLOG) {
            self.reset_ingest(None);
            let _ = self.events.send(PipelineEvent::NeedRestart);
            return;
        }
        self.enc_bytes += chunk.len();
        if let Some(e) = &self.encoder {
            e.feed.write(chunk);
        }
    }

    fn check_health(&mut self) {
        if self.stopped() {
            return;
        }
        let now = now_ms();
        if self.status.state == "live" && now - self.last_ingest > 5000.0 {
            self.status.state = "reconnecting".into();
            self.status.error = Some("Waiting for the program feed (producer reconnecting)…".into());
            self.emit_status(true);
        }
        if now - self.last_ingest < 3000.0 && self.last_output != 0.0 && now - self.last_output > 15_000.0 {
            if let Some(e) = &self.encoder {
                e.kill.notify_one();
            }
        }
        self.emit_status(false);
    }

    fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.status.state = "idle".into();
        self.status.started_at = None;
        if let Some(e) = self.encoder.take() {
            e.retire(Duration::from_secs(2));
        }
        for (i, r) in self.relays.iter_mut().enumerate() {
            self.status.destinations[i].state = "idle".into();
            if let Some(p) = r.proc.take() {
                p.retire(Duration::from_secs(3));
            }
        }
        let _ = self.events.send(PipelineEvent::Status(self.status.clone()));
    }

    async fn run(mut self, mut rx: UnboundedReceiver<Msg>) {
        self.status.state = "starting".into();
        for i in 0..self.relays.len() {
            self.spawn_relay(i);
        }
        self.spawn_encoder();
        let health = self.tx.clone();
        let watchdog = tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(2));
            t.tick().await;
            loop {
                t.tick().await;
                if health.send(Msg::Health).is_err() {
                    break;
                }
            }
        });
        self.emit_status(true);
        while let Some(msg) = rx.recv().await {
            match msg {
                Msg::Write(b) => self.write(b),
                Msg::Reset(m) => self.reset_ingest(m),
                Msg::Stop => {
                    self.stop();
                    break;
                }
                Msg::Out(g, b) => self.on_encoder_output(g, b),
                Msg::Line(Kind::Encoder(g), l) => self.on_encoder_line(g, l),
                Msg::Line(Kind::Relay(i, g), l) => self.on_relay_line(i, g, l),
                Msg::Exit(Kind::Encoder(g), why) => self.on_encoder_exit(g, why),
                Msg::Exit(Kind::Relay(i, g), _) => self.on_relay_exit(i, g),
                Msg::SpawnFailed(Kind::Encoder(_), e) => {
                    self.status.error = Some(format!("ffmpeg failed to start: {e}"));
                    self.status.state = "error".into();
                    self.emit_status(true);
                }
                Msg::SpawnFailed(Kind::Relay(i, g), e) => {
                    push_tail(&mut self.relays[i].tail, format!("failed to start ffmpeg: {e}"), 12);
                    self.on_relay_exit(i, g);
                }
                Msg::RespawnEncoder => {
                    if !self.stopped() && self.encoder.is_none() {
                        self.spawn_encoder();
                        let _ = self.events.send(PipelineEvent::NeedRestart);
                    }
                }
                Msg::RespawnRelay(i) => self.spawn_relay(i),
                Msg::Health => self.check_health(),
            }
        }
        watchdog.abort();
    }
}

/// Handle to a running pipeline. Cheap to clone; writes never block the caller.
#[derive(Clone)]
pub struct LivePipeline {
    tx: UnboundedSender<Msg>,
    running: Arc<AtomicBool>,
}

impl LivePipeline {
    pub fn start(cfg: Arc<Config>, targets: Vec<StreamTarget>, broadcaster: &str, events: UnboundedSender<PipelineEvent>) -> Self {
        let (tx, rx) = unbounded_channel();
        let running = Arc::new(AtomicBool::new(true));
        let destinations = targets
            .iter()
            .map(|t| DestinationStatus {
                id: t.id.clone(),
                platform: t.platform.clone(),
                name: t.name.clone(),
                state: "idle".into(),
                error: None,
                retries: Some(0),
            })
            .collect();
        let relays = targets
            .into_iter()
            .map(|target| Relay {
                target,
                proc: None,
                gen: 0,
                backoff: 1000,
                live_since: 0.0,
                tail: Vec::new(),
            })
            .collect();
        let now = now_ms();
        let worker = Worker {
            cfg,
            tx: tx.clone(),
            events,
            running: running.clone(),
            status: LiveStatus {
                state: "idle".into(),
                mode: "mesh".into(),
                broadcaster: Some(broadcaster.to_string()),
                reconnects: Some(0),
                destinations,
                ..LiveStatus::default()
            },
            relays,
            encoder: None,
            enc_gen: 0,
            started_at: now,
            last_ingest: now,
            last_output: 0.0,
            enc_tail: Vec::new(),
            encoder_restarts: 0,
            enc_bytes: 0,
            video_copy: false,
            awaiting_header: true,
            bytes_in: 0,
            last_emit: 0.0,
        };
        tokio::spawn(worker.run(rx));
        Self { tx, running }
    }

    pub fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn write(&self, chunk: Bytes) {
        let _ = self.tx.send(Msg::Write(chunk));
    }

    pub fn reset_ingest(&self, mime: Option<String>) {
        let _ = self.tx.send(Msg::Reset(mime));
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        let _ = self.tx.send(Msg::Stop);
    }
}
