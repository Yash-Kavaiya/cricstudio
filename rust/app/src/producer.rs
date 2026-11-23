//! Headless Chrome that renders the program page for host-free 24/7 shows, with a watchdog.

use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cricstudio_engine::js::now_ms;
use serde_json::{json, Value};
use tokio::process::{Child, Command};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::Notify;

use crate::config::Config;

const CANDIDATES: [&str; 9] = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

pub fn find_chrome(cfg: &Config) -> Option<String> {
    if !cfg.chrome_path.is_empty() && Path::new(&cfg.chrome_path).exists() {
        return Some(cfg.chrome_path.clone());
    }
    CANDIDATES.iter().find(|p| Path::new(p).exists()).map(|p| (*p).to_string())
}

#[derive(Clone, Copy, Default)]
struct Health {
    fps: f64,
    heap_mb: f64,
    ts: f64,
}

#[derive(Default)]
struct Shared {
    health: Option<Health>,
    last_beat: f64,
    restarts: u32,
}

pub enum ProducerEvent {
    Log(String),
    Fatal(String),
}

pub struct CloudProducer {
    shared: Arc<Mutex<Shared>>,
    stop: Arc<Notify>,
    task: tokio::task::JoinHandle<()>,
}

fn launch(exe: &str, url: &str, profile: &Path) -> std::io::Result<Child> {
    let mut args: Vec<String> = [
        "--headless=new",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        "--use-fake-ui-for-media-stream",
        "--window-size=1920,1080",
        "--ignore-gpu-blocklist",
        "--enable-gpu",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--use-angle=default",
        "--enable-unsafe-swiftshader",
        "--js-flags=--max-old-space-size=1536",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect();
    if cfg!(target_os = "linux") {
        args.extend(["--no-sandbox".to_string(), "--disable-setuid-sandbox".to_string()]);
    }
    args.push(format!("--user-data-dir={}", profile.display()));
    args.push(url.to_string());
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd.spawn()
}

impl CloudProducer {
    pub fn start(cfg: Arc<Config>, studio_id: &str, url: String, events: UnboundedSender<ProducerEvent>) -> Self {
        let shared = Arc::new(Mutex::new(Shared {
            last_beat: now_ms(),
            ..Shared::default()
        }));
        let stop = Arc::new(Notify::new());
        let profile = cfg.data_dir.join("producer").join(studio_id);
        let task = tokio::spawn(supervise(cfg, url, profile, shared.clone(), stop.clone(), events));
        Self { shared, stop, task }
    }

    pub fn heartbeat(&self, fps: f64, heap_mb: f64) {
        if let Ok(mut s) = self.shared.lock() {
            let ts = now_ms();
            s.last_beat = ts;
            s.health = Some(Health { fps, heap_mb, ts });
        }
    }

    pub fn running(&self) -> bool {
        !self.task.is_finished()
    }

    pub fn restarts(&self) -> u32 {
        self.shared.lock().map_or(0, |s| s.restarts)
    }

    pub fn health_json(&self) -> Value {
        self.shared
            .lock()
            .ok()
            .and_then(|s| s.health)
            .map_or(Value::Null, |h| json!({ "fps": h.fps, "heapMb": h.heap_mb, "ts": h.ts }))
    }

    pub fn stop(&self) {
        self.stop.notify_one();
    }
}

async fn supervise(
    cfg: Arc<Config>,
    url: String,
    profile: std::path::PathBuf,
    shared: Arc<Mutex<Shared>>,
    stop: Arc<Notify>,
    events: UnboundedSender<ProducerEvent>,
) {
    let Some(exe) = find_chrome(&cfg) else {
        let _ = events.send(ProducerEvent::Fatal(
            "No Chrome/Chromium found. Set CHROME_PATH (Docker image ships Chromium).".into(),
        ));
        return;
    };
    let _ = std::fs::create_dir_all(&profile);
    let mut failures: u32 = 0;
    loop {
        let mut child = match launch(&exe, &url, &profile) {
            Ok(c) => c,
            Err(e) => {
                failures += 1;
                let _ = events.send(ProducerEvent::Log(format!("[producer] launch failed: {e}")));
                let wait = 60_000u64.min(3000 * 2u64.pow(failures.min(5)));
                tokio::select! {
                    () = tokio::time::sleep(Duration::from_millis(wait)) => continue,
                    () = stop.notified() => return,
                }
            }
        };
        let started = now_ms();
        if let Ok(mut s) = shared.lock() {
            s.last_beat = started;
            s.health = None;
        }
        let mut check = tokio::time::interval(Duration::from_secs(10));
        check.tick().await;
        let reason = loop {
            tokio::select! {
                () = stop.notified() => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    return;
                }
                _ = child.wait() => break "browser exited".to_string(),
                _ = check.tick() => {
                    let now = now_ms();
                    let (health, last) = shared.lock().map_or((None, now), |s| (s.health, s.last_beat));
                    if health.is_some() {
                        failures = 0;
                    }
                    // generous grace on a cold page load, strict once running
                    let grace = if health.is_some() { 40_000.0 } else { 90_000.0 };
                    if now - last > grace {
                        break "no heartbeat".to_string();
                    }
                    if let Some(h) = health.filter(|h| h.heap_mb > cfg.worker_max_heap_mb) {
                        break format!("memory {}MB", h.heap_mb);
                    }
                    if cfg.worker_recycle_hours > 0.0 && now - started > cfg.worker_recycle_hours * 3_600_000.0 {
                        break "scheduled recycle".to_string();
                    }
                }
            }
        };
        if let Ok(mut s) = shared.lock() {
            s.restarts += 1;
        }
        let _ = events.send(ProducerEvent::Log(format!("[producer] restarting: {reason}")));
        let _ = child.start_kill();
        let _ = child.wait().await;
        if reason == "browser exited" {
            failures += 1;
            let wait = 60_000u64.min(1000 * 2u64.pow(failures.min(6)));
            tokio::select! {
                () = tokio::time::sleep(Duration::from_millis(wait)) => {}
                () = stop.notified() => return,
            }
        }
    }
}
