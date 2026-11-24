//! A live studio: state, automation, commentary and the stream, plus the room manager.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, Weak};
use std::time::Duration;

use bytes::Bytes;
use cricstudio_engine::facts::{event_facts, match_facts};
use cricstudio_engine::js::{self, now_iso, now_ms};
use cricstudio_engine::media::{cricket_hints, silent_wav};
use cricstudio_engine::{CricketEvent, MatchDetail, MatchListItem, DEMO_KEY};
use futures_util::future::{BoxFuture, FutureExt, Shared};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use socketioxide::SocketIo;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::task::AbortHandle;

use crate::automation::AutomationEngine;
use crate::catalog;
use crate::commentator::{Commentator, Ctx as CommentaryCtx, Speak};
use crate::config::Config;
use crate::crypto::Crypto;
use crate::hub::{MatchHub, MatchUpdate, Subscription};
use crate::pipeline::{LivePipeline, PipelineEvent, StreamTarget};
use crate::producer::{find_chrome, CloudProducer, ProducerEvent};
use crate::speech::{self, gemini_commentary, gnani_speech, transcribe_with, translate_line, GeminiLine, SttRequest, TtsService, CLOUD_STT};
use crate::state::{restore_state, spread, StudioState, PERSISTED};
use crate::store::{Repo, StudioRecord};

/// Outgoing socket messages, delivered strictly in the order they were produced.
pub enum Out {
    Room(String, String, Value),
    To(String, String, Value),
}

pub struct Services {
    pub cfg: Arc<Config>,
    pub out: UnboundedSender<Out>,
    pub io: SocketIo,
    pub hub: Arc<MatchHub>,
    pub repo: Arc<Repo>,
    pub crypto: Crypto,
    pub tts: TtsService,
    pub http: reqwest::Client,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentaryLine {
    pub id: String,
    pub text: String,
    pub voice: String,
    pub priority: i32,
    pub ts: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<bool>,
}

type AudioFuture = Shared<BoxFuture<'static, Result<Bytes, String>>>;

pub struct Inner {
    pub state: StudioState,
    pub automation: AutomationEngine,
    commentator: Commentator,
    pub chat: Vec<Value>,
    pub pipeline: Option<LivePipeline>,
    pipeline_gen: u64,
    pub cloud: Option<CloudProducer>,
    pub producer_id: Option<String>,
    pub host_left: Option<AbortHandle>,
    match_sub: Option<(Subscription, AbortHandle)>,
    pub latest: Option<Arc<MatchDetail>>,
    emit_queued: bool,
    persist_task: Option<AbortHandle>,
    persist_due_by: f64,
    saved: Option<(String, String)>,
    post_since: f64,
    stt_keys: Map<String, Value>,
    gemini_down_until: f64,
    gnani_down_until: f64,
    lines: VecDeque<(String, Option<AudioFuture>)>,
    log_buf: Vec<String>,
    log_flushing: bool,
    log_writes: u64,
    timers: Vec<AbortHandle>,
}

impl Inner {
    pub fn is_live(&self) -> bool {
        self.pipeline.as_ref().is_some_and(LivePipeline::running)
    }

    pub fn keep_alive(&self) -> bool {
        self.is_live() || self.state.want_live
    }

    fn commentary(&mut self, f: impl FnOnce(&mut Commentator, &CommentaryCtx<'_>) -> Option<Speak>) -> Option<Speak> {
        let enabled = self.state.ap_bool("commentator") && (self.state.ap_bool("enabled") || self.is_live());
        let Self {
            commentator, state, latest, ..
        } = self;
        let cx = CommentaryCtx {
            enabled,
            chatter_seconds: state.ap_num("chatterSeconds", 35.0),
            detail: latest.as_deref(),
            poll: state.brand["pollQuestion"].as_str().unwrap_or(""),
            countdown_to: state.countdown_to,
        };
        f(commentator, &cx)
    }

    fn stt_key(&self, crypto: &Crypto, p: &str) -> Option<String> {
        // a rotated secret reads as "no key"
        self.stt_keys.get(p).and_then(Value::as_str).and_then(|k| crypto.decrypt(k).ok())
    }

    /// Language the commentary is actually spoken in: Edge has no Punjabi voice.
    fn spoken_lang(&self, crypto: &Crypto) -> String {
        let lang = self.state.ap_str("commentaryLanguage").unwrap_or("en-IN").to_string();
        if lang.starts_with("en") || catalog::edge_voice(&lang).is_some() {
            return lang;
        }
        let gnani = self.state.ap_str("voiceEngine") == Some("gnani") && self.stt_key(crypto, "gnani").is_some() && now_ms() >= self.gnani_down_until;
        if gnani {
            lang
        } else {
            "hi-IN".into()
        }
    }
}

static INTL: LazyLock<Regex> = LazyLock::new(|| Regex::new("world cup|champions trophy|asia cup|tour of|test|odi|t20i").expect("static regex"));
static LEAGUE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("premier league|ipl|big bash|psl|caribbean|sa20|hundred|major league|ilt20|wpl").expect("static regex"));
static LANG_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$").expect("static regex"));
static MODEL_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_./-]{3,80}$").expect("static regex"));

/// Prefer international cricket, then major T20 leagues, then everything else.
fn match_rank(m: &MatchListItem) -> i32 {
    let t = format!("{} {}", m.league_name, m.description).to_lowercase();
    let mut r = match m.state.as_str() {
        "in" => 1000,
        "pre" => 0,
        _ => -1000,
    };
    if INTL.is_match(&t) {
        r += 300;
    }
    if LEAGUE.is_match(&t) {
        r += 200;
    }
    if t.contains("women") {
        r += 20;
    }
    if m.teams.iter().any(|x| !x.score.is_empty()) {
        r += 10;
    }
    r
}

pub struct Room {
    pub id: String,
    pub room_name: String,
    pub record: StudioRecord,
    pub svc: Arc<Services>,
    inner: Mutex<Inner>,
    me: Weak<Room>,
}

impl Room {
    pub fn new(record: StudioRecord, svc: Arc<Services>) -> Arc<Self> {
        let (state, stt_keys) = restore_state(&record, &svc.cfg.tts_voice);
        let id = state.id.clone();
        let initial_match = record.match_key.clone();
        let room = Arc::new_cyclic(|me| Self {
            room_name: format!("studio:{id}"),
            id,
            record,
            svc,
            me: me.clone(),
            inner: Mutex::new(Inner {
                state,
                automation: AutomationEngine::default(),
                commentator: Commentator::default(),
                chat: Vec::new(),
                pipeline: None,
                pipeline_gen: 0,
                cloud: None,
                producer_id: None,
                host_left: None,
                match_sub: None,
                latest: None,
                emit_queued: false,
                persist_task: None,
                persist_due_by: 0.0,
                saved: None,
                post_since: 0.0,
                stt_keys,
                gemini_down_until: 0.0,
                gnani_down_until: 0.0,
                lines: VecDeque::new(),
                log_buf: Vec::new(),
                log_flushing: false,
                log_writes: 0,
                timers: Vec::new(),
            }),
        });
        let timers = vec![
            Self::every(&room, Duration::from_millis(500), |r| async move { r.automation_tick() }),
            Self::every(&room, Duration::from_secs(3), |r| async move { r.chatter() }),
            Self::every(&room, Duration::from_secs(60), |r| async move { r.auto_match(false).await }),
        ];
        {
            let mut g = room.lock();
            g.timers = timers;
            if let Some(k) = initial_match {
                room.set_match_locked(&mut g, Some(k));
            }
        }
        room
    }

    fn every<F, Fut>(room: &Arc<Self>, period: Duration, f: F) -> AbortHandle
    where
        F: Fn(Arc<Room>) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        let weak = Arc::downgrade(room);
        tokio::spawn(async move {
            let mut t = tokio::time::interval(period);
            t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            t.tick().await;
            loop {
                t.tick().await;
                let Some(r) = weak.upgrade() else { break };
                f(r).await;
            }
        })
        .abort_handle()
    }

    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn emit_room(&self, event: &str, data: impl Serialize) {
        if let Ok(v) = serde_json::to_value(data) {
            let _ = self.svc.out.send(Out::Room(self.room_name.clone(), event.to_string(), v));
        }
    }

    pub fn emit_to(&self, sid: &str, event: &str, data: impl Serialize) {
        if let Ok(v) = serde_json::to_value(data) {
            let _ = self.svc.out.send(Out::To(sid.to_string(), event.to_string(), v));
        }
    }

    /* ---------------- state sync ---------------- */

    /// Coalesce broadcasts to one per tick. Saving is debounced 1.5 s but never waits over 10 s.
    pub fn commit(&self, g: &mut Inner) {
        self.commit_with(g, true);
    }

    fn commit_with(&self, g: &mut Inner, persist: bool) {
        if !g.emit_queued {
            g.emit_queued = true;
            let weak = self.me.clone();
            tokio::spawn(async move {
                tokio::task::yield_now().await;
                let Some(r) = weak.upgrade() else { return };
                let snapshot = {
                    let mut g = r.lock();
                    g.emit_queued = false;
                    serde_json::to_value(&g.state)
                };
                if let Ok(v) = snapshot {
                    let _ = r.svc.out.send(Out::Room(r.room_name.clone(), "studio:state".into(), v));
                }
            });
        }
        if !persist {
            return;
        }
        let now = now_ms();
        if g.persist_due_by == 0.0 {
            g.persist_due_by = now + 10_000.0;
        }
        if let Some(t) = g.persist_task.take() {
            t.abort();
        }
        let wait = (g.persist_due_by - now).clamp(0.0, 1500.0) as u64;
        let weak = self.me.clone();
        g.persist_task = Some(
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(wait)).await;
                if let Some(r) = weak.upgrade() {
                    r.persist();
                }
            })
            .abort_handle(),
        );
    }

    pub fn persist(&self) {
        let mut g = self.lock();
        if let Some(t) = g.persist_task.take() {
            t.abort();
        }
        g.persist_due_by = 0.0;
        let Ok(Value::Object(all)) = serde_json::to_value(&g.state) else { return };
        let mut out = Map::new();
        for k in PERSISTED {
            if let Some(v) = all.get(k) {
                out.insert(k.to_string(), v.clone());
            }
        }
        out.insert("sttKeys".into(), Value::Object(g.stt_keys.clone()));
        let Ok(settings) = js::stringify(&out) else { return };
        let name = g.state.name.clone();
        if g.saved.as_ref().is_some_and(|(s, n)| *s == settings && *n == name) {
            return;
        }
        match self.svc.repo.save_settings(&self.id, &settings, &name) {
            Ok(()) => g.saved = Some((settings, name)),
            Err(e) => {
                g.saved = None; // retry on the next save
                tracing::warn!("[studio] persist {} failed: {e}", self.id);
            }
        }
    }

    fn automation_tick(&self) {
        let mut guard = self.lock();
        let g = &mut *guard;
        let latest = g.latest.clone();
        if g.automation.tick(&mut g.state, latest.as_deref()) {
            self.commit(g);
        }
    }

    fn chatter(&self) {
        let s = self.lock().commentary(Commentator::chatter);
        if let Some(s) = s {
            self.say(s);
        }
    }

    /* ---------------- match ---------------- */

    pub fn set_match_locked(&self, g: &mut Inner, key: Option<String>) {
        if let Some((sub, task)) = g.match_sub.take() {
            drop(sub);
            task.abort();
        }
        g.latest = None;
        g.post_since = 0.0;
        g.state.match_key.clone_from(&key);
        g.automation.refresh_playlist();
        if let Some(k) = &key {
            let (tx, mut rx) = unbounded_channel::<MatchUpdate>();
            let sub = self.svc.hub.subscribe(k, tx);
            let weak = self.me.clone();
            let task = tokio::spawn(async move {
                let mut first = true;
                while let Some(u) = rx.recv().await {
                    let Some(r) = weak.upgrade() else { break };
                    r.on_update(u, first);
                    first = false;
                }
            });
            g.match_sub = Some((sub, task.abort_handle()));
        }
        if let Err(e) = self.svc.repo.set_match_key(&self.id, key.as_deref()) {
            tracing::warn!("[studio] saving match for {} failed: {e}", self.id);
        }
        self.commit(g);
    }

    fn on_update(&self, u: MatchUpdate, first: bool) {
        let mut speak = Vec::new();
        {
            let mut guard = self.lock();
            let g = &mut *guard;
            g.latest = Some(u.detail.clone());
            self.emit_room("match:update", &*u.detail);
            if first && g.state.ap_bool("enabled") {
                let title = g.state.brand["title"].as_str().unwrap_or("").to_string();
                speak.extend(g.commentary(|c, cx| c.intro(&title, cx)));
                // open the show on the new match with the 3D fly-in
                g.automation.cut(&mut g.state, "intro3d", None, true);
                self.commit(g);
            }
            if !u.events.is_empty() {
                self.emit_room("match:events", &u.events);
                let outcome = g.automation.on_events(&mut g.state, Some(&u.detail), &u.events);
                if outcome.dirty {
                    self.commit(g);
                }
                if let Some(h) = g.state.host().map(|h| h.id.clone()) {
                    for s in outcome.suggestions {
                        self.emit_to(&h, "automation:suggestion", s);
                    }
                }
                speak.extend(g.commentary(|c, cx| c.on_events(&u.events, cx)));
            }
        }
        for s in speak {
            self.say(s);
        }
    }

    /// 24/7: keep a live match on air; fall back to the demo replay when nothing is live.
    pub async fn auto_match(&self, force: bool) {
        {
            let mut g = self.lock();
            if !g.state.ap_bool("enabled") || !g.state.ap_bool("autoMatch") {
                return;
            }
            let now = now_ms();
            let post = g.latest.as_ref().is_some_and(|m| m.state == "post");
            if post && g.post_since == 0.0 {
                g.post_since = now;
            }
            let done = post && now - g.post_since > 600_000.0;
            let idle = g.state.match_key.as_deref().is_none_or(|k| k == DEMO_KEY);
            if !force && !done && !idle {
                return;
            }
        }
        let list = self.svc.hub.list_matches().await;
        let mut live: Vec<&MatchListItem> = list.iter().filter(|m| m.is_demo != Some(true) && m.state == "in").collect();
        live.sort_by_key(|m| std::cmp::Reverse(match_rank(m)));
        let best = live.first().copied();
        let key = best.map_or_else(|| DEMO_KEY.to_string(), |b| format!("{}:{}", b.league_id, b.id));
        let changed = {
            let mut g = self.lock();
            let changed = g.state.match_key.as_deref() != Some(key.as_str());
            if changed {
                self.set_match_locked(&mut g, Some(key));
            }
            changed
        };
        if changed {
            let text = best.map_or_else(
                || "No live matches right now, so here is a classic replay.".to_string(),
                |b| format!("We're heading over to {}. {}.", b.name, b.status_text),
            );
            let (t, lang) = self.localize(&text).await;
            self.speak_text(t, 2, Some(lang));
        }
    }

    /* ---------------- commentary ---------------- */

    async fn localize(&self, text: &str) -> (String, String) {
        let lang = self.lock().spoken_lang(&self.svc.crypto);
        if lang.starts_with("en") {
            return (text.to_string(), lang);
        }
        match translate_line(&self.svc.http, text, Some(&lang)).await {
            Some(out) => (out, lang),
            None => (text.to_string(), "en-IN".into()),
        }
    }

    fn set_ai_status(&self, g: &mut Inner, patch: Value) {
        let base = g.state.ai_status.clone().unwrap_or_else(|| {
            json!({
                "writer": if g.state.ap_str("writer") == Some("gemini") { "gemini" } else { "templates" },
                "voice": if g.state.ap_str("voiceEngine") == Some("gnani") { "gnani" } else { "edge" },
            })
        });
        let mut next = spread(&base, &patch);
        if let Some(o) = next.as_object_mut() {
            o.retain(|_, v| !v.is_null());
        }
        if g.state.ai_status.as_ref() == Some(&next) {
            return;
        }
        g.state.ai_status = Some(next);
        self.commit(g);
    }

    async fn write_ai(&self, ev: Option<&CricketEvent>, fallback: &str, recent: &[String]) -> (String, bool) {
        let (key, model, language, facts, event) = {
            let mut guard = self.lock();
            let g = &mut *guard;
            if g.state.ap_str("writer") != Some("gemini") || now_ms() < g.gemini_down_until {
                return (fallback.to_string(), false);
            }
            let Some(key) = g.stt_key(&self.svc.crypto, "gemini") else {
                self.set_ai_status(
                    g,
                    json!({ "writer": "fallback", "error": "Gemini selected but no Google AI Studio key is saved" }),
                );
                return (fallback.to_string(), false);
            };
            let d = g.latest.clone();
            (
                key,
                g.state.stt["geminiModel"].as_str().unwrap_or("gemini-2.5-flash").to_string(),
                g.spoken_lang(&self.svc.crypto),
                match_facts(d.as_deref(), g.state.countdown_to, now_ms()),
                event_facts(ev, d.as_deref()),
            )
        };
        let result = gemini_commentary(
            &self.svc.http,
            GeminiLine {
                key: &key,
                model: &model,
                language: &language,
                facts: &facts,
                event: &event,
                fallback,
                recent,
            },
        )
        .await;
        let mut guard = self.lock();
        let g = &mut *guard;
        match result {
            Ok(text) => {
                self.set_ai_status(g, json!({ "writer": "gemini", "error": null }));
                (text, true)
            }
            Err(e) => {
                g.gemini_down_until = now_ms() + 30_000.0;
                self.set_ai_status(g, json!({ "writer": "fallback", "error": e.to_string() }));
                (fallback.to_string(), false)
            }
        }
    }

    fn say(&self, s: Speak) {
        let Some(me) = self.me.upgrade() else { return };
        let ts = now_ms();
        tokio::spawn(async move {
            let (written, ai) = me.write_ai(s.event.as_ref(), &s.text, &s.recent).await;
            let (text, lang) = if ai {
                let lang = me.lock().spoken_lang(&me.svc.crypto);
                (written, lang)
            } else {
                me.localize(&s.text).await
            };
            let (text, ai) = if text.is_empty() { (s.text, false) } else { (text, ai) };
            let (id, voice) = {
                let mut g = me.lock();
                if ai {
                    g.commentator.remember(&text);
                }
                (g.commentator.next_id(ts), g.state.ap_str("voice").unwrap_or("").to_string())
            };
            me.speak(CommentaryLine {
                id,
                text,
                voice,
                priority: s.priority,
                ts,
                engine: None,
                lang: Some(lang),
                ai: Some(ai),
            });
        });
    }

    fn speak(&self, mut line: CommentaryLine) {
        let mut guard = self.lock();
        let g = &mut *guard;
        let lang = line.lang.clone().unwrap_or_else(|| {
            if line.ai == Some(true) {
                g.spoken_lang(&self.svc.crypto)
            } else {
                "en-IN".into()
            }
        });
        let ap_voice = g.state.ap_str("voice").unwrap_or("").to_string();
        let edge = if lang.starts_with("en") {
            ap_voice
        } else {
            catalog::edge_voice(&lang).map_or(ap_voice, str::to_string)
        };
        let wants_gnani = g.state.ap_str("voiceEngine") == Some("gnani");
        let gnani_key = g.stt_key(&self.svc.crypto, "gnani").filter(|_| wants_gnani && now_ms() >= g.gnani_down_until);
        if wants_gnani && gnani_key.is_none() {
            self.set_ai_status(g, json!({ "voice": "fallback", "error": "Gnani voice selected but no Gnani key is saved" }));
        }
        line.engine = Some(if gnani_key.is_some() { "gnani" } else { "edge" }.into());
        line.voice = edge;
        line.lang = Some(lang.clone());
        let audio = gnani_key.map(|key| {
            let voice = g
                .state
                .ap_str("gnaniVoice")
                .filter(|v| catalog::GNANI_VOICES.contains(v))
                .unwrap_or("Shubham")
                .to_string();
            // start now so the audio is ready when the program page asks for it
            let fut: AudioFuture = gnani_speech(self.svc.http.clone(), key, line.text.clone(), voice, lang, line.priority >= 2)
                .boxed()
                .shared();
            let (watch, weak) = (fut.clone(), self.me.clone());
            tokio::spawn(async move {
                let result = watch.await;
                let Some(r) = weak.upgrade() else { return };
                let mut guard = r.lock();
                let g = &mut *guard;
                match result {
                    Ok(_) => r.set_ai_status(g, json!({ "voice": "gnani" })),
                    Err(e) => {
                        g.gnani_down_until = now_ms() + 30_000.0;
                        r.set_ai_status(g, json!({ "voice": "fallback", "error": e }));
                    }
                }
            });
            fut
        });
        g.lines.push_back((line.id.clone(), audio));
        while g.lines.len() > 20 {
            g.lines.pop_front();
        }
        self.emit_room("commentary:say", &line);
        self.emit_room(
            "captions:text",
            json!({ "from": "AI Commentator", "text": line.text, "final": true, "ts": now_ms() }),
        );
    }

    /// Host-typed announcement, spoken even when the AI commentator is off.
    pub fn announce(&self, text: String) {
        let Some(me) = self.me.upgrade() else { return };
        tokio::spawn(async move {
            let (text, lang) = me.localize(&text).await;
            let ts = now_ms();
            let voice = me.lock().state.ap_str("voice").unwrap_or("").to_string();
            me.speak(CommentaryLine {
                id: format!("a{}", js::num_str(ts)),
                text,
                voice,
                priority: 4,
                ts,
                engine: None,
                lang: Some(lang),
                ai: None,
            });
        });
    }

    pub fn speak_text(&self, text: String, priority: i32, lang: Option<String>) {
        let voice = {
            let g = self.lock();
            if !g.state.ap_bool("commentator") {
                return;
            }
            g.state.ap_str("voice").unwrap_or("").to_string()
        };
        let ts = now_ms();
        self.speak(CommentaryLine {
            id: format!("m{}", js::num_str(ts)),
            text,
            voice,
            priority,
            ts,
            engine: None,
            lang,
            ai: None,
        });
    }

    pub fn commentary_intro(&self) {
        let s = {
            let mut g = self.lock();
            let title = g.state.brand["title"].as_str().unwrap_or("").to_string();
            g.commentary(|c, cx| c.intro(&title, cx))
        };
        if let Some(s) = s {
            self.say(s);
        }
    }

    pub fn commentary_countdown(&self) {
        let s = self.lock().commentary(Commentator::countdown_set);
        if let Some(s) = s {
            self.say(s);
        }
    }

    pub fn commentary_events(&self, events: &[CricketEvent]) {
        let s = self.lock().commentary(|c, cx| c.on_events(events, cx));
        if let Some(s) = s {
            self.say(s);
        }
    }

    /// Gnani audio for a line this room spoke, or None so the client uses the Edge voice.
    pub async fn tts_line(&self, id: &str) -> Option<Bytes> {
        let fut = {
            let g = self.lock();
            g.lines.iter().find(|(l, _)| l == id).and_then(|(_, a)| a.clone())
        }?;
        fut.await.ok()
    }

    /// Check the AI commentary setup end-to-end with a sample line.
    pub async fn test_commentary(&self) -> CommentaryTest {
        let fallback = "What a shot! That races away to the boundary for four.";
        let mut out = CommentaryTest {
            ok: true,
            text: fallback.into(),
            ..CommentaryTest::default()
        };
        let (writer, voice_engine, gemini, gnani, model, spoken, gnani_voice, d) = {
            let g = self.lock();
            (
                g.state.ap_str("writer").map(str::to_string),
                g.state.ap_str("voiceEngine").map(str::to_string),
                g.stt_key(&self.svc.crypto, "gemini"),
                g.stt_key(&self.svc.crypto, "gnani"),
                g.state.stt["geminiModel"].as_str().unwrap_or("gemini-2.5-flash").to_string(),
                g.spoken_lang(&self.svc.crypto),
                g.state.ap_str("gnaniVoice").unwrap_or("Shubham").to_string(),
                g.latest.clone(),
            )
        };
        if writer.as_deref() == Some("gemini") {
            match &gemini {
                None => out.writer_error = Some("No Google AI Studio key saved".into()),
                Some(key) => {
                    let facts = match_facts(d.as_deref(), None, now_ms());
                    let line = GeminiLine {
                        key,
                        model: &model,
                        language: &spoken,
                        facts: &facts,
                        event: "A cracking boundary just now.",
                        fallback,
                        recent: &[],
                    };
                    match gemini_commentary(&self.svc.http, line).await {
                        Ok(t) => {
                            out.text = t;
                            out.ai = true;
                        }
                        Err(e) => out.writer_error = Some(e.to_string()),
                    }
                }
            }
        }
        let lang = if out.ai {
            spoken
        } else {
            let (t, l) = self.localize(&out.text).await;
            out.text = t;
            l
        };
        out.lang = Some(lang.clone());
        if voice_engine.as_deref() == Some("gnani") {
            match gnani {
                None => out.voice_error = Some("No Gnani key saved".into()),
                Some(key) => match gnani_speech(self.svc.http.clone(), key, out.text.clone(), gnani_voice, lang, true).await {
                    Ok(a) => {
                        out.audio = Some(a);
                        out.voice_ok = Some(true);
                    }
                    Err(e) => out.voice_error = Some(e),
                },
            }
        }
        out
    }

    /* ---------------- live pipeline ---------------- */

    fn internal_web_url(&self) -> String {
        let c = &self.svc.cfg;
        if !c.internal_web_url.is_empty() {
            return c.internal_web_url.clone();
        }
        if c.production && c.web_dist.exists() {
            format!("http://127.0.0.1:{}", c.port)
        } else {
            c.public_url.clone()
        }
    }

    pub fn load_targets(&self) -> anyhow::Result<Vec<StreamTarget>> {
        self.svc
            .repo
            .list_destinations(&self.id)?
            .into_iter()
            .filter(|d| d.enabled)
            .map(|d| {
                Ok(StreamTarget {
                    key: self.svc.crypto.decrypt(&d.key_enc)?,
                    id: d.id,
                    platform: d.platform,
                    name: d.name,
                    url: d.url,
                })
            })
            .collect()
    }

    pub fn start_live(&self, broadcaster: &str) -> Result<(), String> {
        let cfg = self.svc.cfg.clone();
        if self.lock().is_live() {
            return Err("Already live".into());
        }
        if cfg.streaming_disabled {
            return Err("Live streaming is off on this hosted site: Vercel cuts every connection after ~5 minutes, which ends YouTube streams. Run CricStudio on your PC and go live from there.".into());
        }
        let targets = self.load_targets().map_err(|e| e.to_string())?;
        if targets.is_empty() {
            return Err("Add and enable at least one destination (YouTube, Facebook, X, Twitch…).".into());
        }
        if broadcaster == "cloud" && find_chrome(&cfg).is_none() {
            return Err("Cloud producer needs Chrome/Chromium on the server (set CHROME_PATH).".into());
        }
        let (tx, mut rx) = unbounded_channel();
        let pipeline = LivePipeline::start(cfg, targets, broadcaster, tx);
        let generation = {
            let mut g = self.lock();
            g.pipeline_gen += 1;
            g.pipeline = Some(pipeline);
            g.state.live.broadcaster = Some(broadcaster.to_string());
            g.state.want_live = true;
            if broadcaster == "cloud" {
                g.state.autopilot["enabled"] = json!(true);
                g.state.autopilot["cloud"] = json!(true);
            }
            g.pipeline_gen
        };
        let (weak, name) = (self.me.clone(), broadcaster.to_string());
        tokio::spawn(async move {
            let mut last_logged = String::new();
            while let Some(ev) = rx.recv().await {
                let Some(r) = weak.upgrade() else { break };
                r.on_pipeline_event(ev, generation, &name, &mut last_logged);
            }
        });
        if broadcaster == "cloud" {
            self.ensure_cloud();
        }
        {
            let mut g = self.lock();
            self.commit(&mut g);
        }
        self.persist();
        Ok(())
    }

    fn on_pipeline_event(&self, ev: PipelineEvent, generation: u64, broadcaster: &str, last_logged: &mut String) {
        match ev {
            PipelineEvent::Status(s) => {
                let mut guard = self.lock();
                let g = &mut *guard;
                if g.pipeline_gen != generation || g.pipeline.is_none() {
                    return;
                }
                let dests: Vec<String> = s
                    .destinations
                    .iter()
                    .map(|d| format!("{}:{}:{}", d.name, d.state, d.error.as_deref().unwrap_or("")))
                    .collect();
                let sig = format!("{}|{}|{}", s.state, s.error.as_deref().unwrap_or(""), dests.join(","));
                if sig != *last_logged {
                    last_logged.clone_from(&sig);
                    let d: Vec<String> = s
                        .destinations
                        .iter()
                        .map(|d| match &d.error {
                            Some(e) => format!("{}={} ({e})", d.name, d.state),
                            None => format!("{}={}", d.name, d.state),
                        })
                        .collect();
                    let err = s.error.as_ref().map_or_else(String::new, |e| format!(" · {e}"));
                    let fps = s.fps.map_or_else(|| "-".to_string(), js::num_str);
                    let speed = s.speed.map_or_else(|| "-".to_string(), js::num_str);
                    self.stream_log(g, format!("status {}{err} · fps={fps} speed={speed} · {}", s.state, d.join(", ")));
                }
                let keep = g.state.live.broadcaster.clone().unwrap_or_else(|| broadcaster.to_string());
                g.state.live = s;
                g.state.live.mode = "mesh".into();
                g.state.live.broadcaster = Some(keep);
                self.commit_with(g, false);
            }
            PipelineEvent::NeedRestart => {
                let g = self.lock();
                let id = if g.state.live.broadcaster.as_deref() == Some("cloud") {
                    g.producer_id.clone()
                } else {
                    g.state.host().map(|h| h.id.clone())
                };
                drop(g);
                if let Some(id) = id {
                    self.emit_to(&id, "stream:restart", ());
                }
            }
            PipelineEvent::Log(line) => self.log_to_host(line),
        }
    }

    pub fn ensure_cloud(&self) {
        if self.lock().cloud.as_ref().is_some_and(CloudProducer::running) {
            return;
        }
        let cfg = self.svc.cfg.clone();
        let web = self.internal_web_url();
        // the producer's socket goes straight to this server: it carries ~6 Mbps
        let api = format!("http://127.0.0.1:{}", cfg.port);
        let extra = if web.starts_with(&api) {
            String::new()
        } else {
            format!("&api={}", urlencoding::encode(&api))
        };
        let url = format!("{web}/program/{}?k={}&producer=1{extra}", self.id, urlencoding::encode(&cfg.worker_secret));
        let (tx, mut rx) = unbounded_channel();
        let producer = CloudProducer::start(cfg, &self.id, url, tx);
        self.lock().cloud = Some(producer);
        let weak = self.me.clone();
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let Some(r) = weak.upgrade() else { break };
                match ev {
                    ProducerEvent::Log(l) => r.log_to_host(l),
                    ProducerEvent::Fatal(e) => {
                        let mut g = r.lock();
                        g.state.live.state = "error".into();
                        g.state.live.error = Some(e);
                        r.commit(&mut g);
                    }
                }
            }
        });
    }

    pub fn on_producer_joined(&self, sid: &str) {
        let start = {
            let mut g = self.lock();
            g.producer_id = Some(sid.to_string());
            g.is_live() && g.state.live.broadcaster.as_deref() == Some("cloud")
        };
        if start {
            self.emit_to(sid, "producer:start", ());
        }
    }

    /// The host's browser dropped while producing: hand the show to the cloud.
    pub fn schedule_failover(&self) {
        let mut g = self.lock();
        if !g.is_live() || g.state.live.broadcaster.as_deref() != Some("host") {
            return;
        }
        if let Some(t) = g.host_left.take() {
            t.abort();
        }
        let (weak, wait) = (self.me.clone(), self.svc.cfg.host_failover_ms);
        g.host_left = Some(
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(wait)).await;
                let Some(r) = weak.upgrade() else { return };
                {
                    let mut g = r.lock();
                    g.host_left = None;
                    if g.state.host().is_some() || !g.is_live() {
                        return;
                    }
                    if find_chrome(&r.svc.cfg).is_none() {
                        drop(g);
                        r.log_to_host("Host disconnected and no cloud producer is available — stream paused.".into());
                        return;
                    }
                    g.state.live.broadcaster = Some("cloud".into());
                    g.state.autopilot["enabled"] = json!(true);
                    r.commit(&mut g);
                }
                r.ensure_cloud();
            })
            .abort_handle(),
        );
    }

    /// Server shutting down: stop cleanly but keep `wantLive` so it resumes on the next boot.
    pub fn suspend_live(&self) {
        {
            let mut g = self.lock();
            if !g.is_live() {
                return;
            }
            if let Some(p) = g.pipeline.take() {
                p.stop();
            }
            if let Some(c) = g.cloud.take() {
                c.stop();
            }
        }
        self.persist();
    }

    pub fn stop_live(&self) {
        let producer = {
            let mut guard = self.lock();
            let g = &mut *guard;
            self.stream_log(g, "stop requested (End broadcast)".into());
            g.state.want_live = false;
            if let Some(p) = g.pipeline.take() {
                p.stop();
            }
            if let Some(c) = g.cloud.take() {
                c.stop();
            }
            g.state.live.state = "idle".into();
            g.state.live.started_at = None;
            g.state.live.error = None;
            for d in &mut g.state.live.destinations {
                d.state = "idle".into();
            }
            self.commit(g);
            g.producer_id.clone()
        };
        if let Some(id) = producer {
            self.emit_to(&id, "producer:stop", ());
        }
        self.persist();
    }

    /// Host browser rejoined: if the show should be live from it, restart and ask it to send.
    pub fn resume_host_stream(&self, sid: &str) {
        {
            let g = self.lock();
            if !g.state.want_live || g.is_live() || g.state.live.broadcaster.as_deref().unwrap_or("host") != "host" {
                return;
            }
        }
        let res = self.start_live("host");
        let msg = match &res {
            Ok(()) => "ok".to_string(),
            Err(e) => e.clone(),
        };
        {
            let mut g = self.lock();
            self.stream_log(&mut g, format!("host rejoined → resume live: {msg}"));
        }
        if res.is_ok() {
            self.emit_to(sid, "producer:start", ());
        }
    }

    fn log_to_host(&self, line: String) {
        let host = {
            let mut g = self.lock();
            self.stream_log(&mut g, line.clone());
            g.state.host().map(|h| h.id.clone())
        };
        if let Some(h) = host {
            self.emit_to(&h, "stream:log", line);
        }
    }

    /// Append to data/logs/stream-<id>.log (kept small); buffered so it never blocks the stream.
    fn stream_log(&self, g: &mut Inner, line: String) {
        g.log_buf.push(format!("{} {line}\n", now_iso()));
        if g.log_buf.len() > 500 {
            let extra = g.log_buf.len() - 500;
            g.log_buf.drain(..extra);
        }
        if g.log_flushing {
            return;
        }
        g.log_flushing = true;
        let Some(me) = self.me.upgrade() else { return };
        tokio::spawn(async move {
            let dir = me.svc.cfg.data_dir.join("logs");
            let file = dir.join(format!("stream-{}.log", me.id));
            loop {
                let (chunk, check) = {
                    let mut g = me.lock();
                    if g.log_buf.is_empty() {
                        g.log_flushing = false;
                        break;
                    }
                    let chunk = g.log_buf.concat();
                    g.log_buf.clear();
                    let check = g.log_writes % 50 == 0;
                    g.log_writes += 1;
                    (chunk, check)
                };
                if check {
                    let _ = tokio::fs::create_dir_all(&dir).await;
                    let size = tokio::fs::metadata(&file).await.map_or(0, |m| m.len());
                    if size > 2_000_000 {
                        let _ = tokio::fs::rename(&file, file.with_extension("log.1")).await;
                    }
                }
                if let Ok(mut f) = tokio::fs::OpenOptions::new().create(true).append(true).open(&file).await {
                    let _ = f.write_all(chunk.as_bytes()).await;
                }
            }
        });
    }

    /* ---------------- speech-to-text ---------------- */

    pub fn set_stt(&self, p: &Value) -> Value {
        let result = {
            let mut guard = self.lock();
            let g = &mut *guard;
            let mut stt = g.state.stt.clone();
            if let Some(v) = p["provider"].as_str().filter(|v| *v == "browser" || CLOUD_STT.contains(v)) {
                stt["provider"] = json!(v);
            }
            if let Some(v) = p["language"].as_str().filter(|v| LANG_TAG.is_match(v)) {
                stt["language"] = json!(v);
            }
            if let Some(v) = p["geminiModel"].as_str().map(js::trim).filter(|v| MODEL_ID.is_match(v)) {
                stt["geminiModel"] = json!(v);
            }
            for k in CLOUD_STT {
                let Some(v) = p["keys"].get(k) else { continue };
                let text = if v.is_null() { String::new() } else { js::to_string(v) };
                let text = js::trim(&text);
                if text.is_empty() {
                    g.stt_keys.shift_remove(k);
                } else if let Ok(enc) = self.svc.crypto.encrypt(&speech::slice_units(text, 400)) {
                    g.stt_keys.insert(k.to_string(), json!(enc));
                }
            }
            stt["configured"] =
                json!({ "gnani": g.stt_keys.contains_key("gnani"), "google": g.stt_keys.contains_key("google"), "gemini": g.stt_keys.contains_key("gemini") });
            g.state.stt = stt.clone();
            g.state.ai_status = None;
            g.gemini_down_until = 0.0;
            g.gnani_down_until = 0.0;
            self.commit(g);
            stt
        };
        self.persist();
        result
    }

    /// Chosen provider first, then any other with a key.
    pub async fn transcribe(&self, wav: &[u8]) -> anyhow::Result<(String, String)> {
        let (order, language, model, hints) = {
            let g = self.lock();
            let chosen = g.state.stt["provider"].as_str().unwrap_or("browser").to_string();
            let mut order: Vec<(String, String)> = Vec::new();
            for p in std::iter::once(chosen.as_str()).chain(CLOUD_STT) {
                if p != "browser" && !order.iter().any(|(x, _)| x == p) {
                    if let Some(k) = g.stt_key(&self.svc.crypto, p) {
                        order.push((p.to_string(), k));
                    }
                }
            }
            (
                order,
                g.state.stt["language"].as_str().unwrap_or("en-IN").to_string(),
                g.state.stt["geminiModel"].as_str().unwrap_or("gemini-2.5-flash").to_string(),
                cricket_hints(g.latest.as_deref()),
            )
        };
        let mut last: Option<anyhow::Error> = None;
        for (p, key) in order {
            match transcribe_with(
                &self.svc.http,
                &p,
                SttRequest {
                    wav,
                    language: &language,
                    key: &key,
                    gemini_model: &model,
                    hints: &hints,
                },
            )
            .await
            {
                Ok(text) => return Ok((text, p)),
                Err(e) => {
                    tracing::warn!("[stt] {p} failed: {e}");
                    last = Some(e);
                }
            }
        }
        Err(last.unwrap_or_else(|| anyhow::anyhow!("No speech-to-text API key saved")))
    }

    /// Check a key (the saved one when `key` is omitted) with half a second of silence.
    pub async fn test_stt(&self, provider: &str, key: Option<&str>) -> Value {
        let (saved, language, model) = {
            let g = self.lock();
            (
                g.stt_key(&self.svc.crypto, provider),
                g.state.stt["language"].as_str().unwrap_or("en-IN").to_string(),
                g.state.stt["geminiModel"].as_str().unwrap_or("gemini-2.5-flash").to_string(),
            )
        };
        let Some(k) = key.map(js::trim).filter(|k| !k.is_empty()).map(str::to_string).or(saved) else {
            return json!({ "ok": false, "error": "No API key saved", "ms": 0 });
        };
        let t0 = now_ms();
        let wav = silent_wav(0.5);
        match transcribe_with(
            &self.svc.http,
            provider,
            SttRequest {
                wav: &wav,
                language: &language,
                key: &k,
                gemini_model: &model,
                hints: &[],
            },
        )
        .await
        {
            Ok(_) => json!({ "ok": true, "ms": now_ms() - t0 }),
            Err(e) => json!({ "ok": false, "error": e.to_string(), "ms": now_ms() - t0 }),
        }
    }

    /* ---------------- rehearsal ---------------- */

    pub fn simulate(&self, kind: &str) -> CricketEvent {
        let ev = {
            let mut guard = self.lock();
            let g = &mut *guard;
            let d = g.latest.clone();
            let last = d.as_ref().and_then(|m| m.recent_balls.last().cloned());
            let bat = last.as_ref().and_then(|b| b.batsman.as_ref()).map(|x| x.name.clone());
            let non = last.as_ref().and_then(|b| b.non_striker.as_ref()).map(|x| x.name.clone());
            let bowl = last.as_ref().and_then(|b| b.bowler.as_ref()).map(|x| x.name.clone());
            let num = js::num_str;
            let over = last.as_ref().map_or(1.0, |b| b.over_number);
            let (title, subtitle, value): (String, Option<String>, Option<f64>) = match kind {
                "FOUR" => (
                    "FOUR!".into(),
                    Some(if last.is_some() {
                        format!("{} finds the rope", bat.as_deref().unwrap_or("Batter"))
                    } else {
                        "Cracking shot to the fence".into()
                    }),
                    None,
                ),
                "SIX" => (
                    "SIX!".into(),
                    Some(if last.is_some() {
                        format!("{} goes downtown", bat.as_deref().unwrap_or("Batter"))
                    } else {
                        "Into the stands!".into()
                    }),
                    None,
                ),
                "WICKET" => (
                    "WICKET!".into(),
                    Some(bat.as_ref().map_or_else(|| "Big breakthrough".to_string(), |b| format!("{b} has to go"))),
                    Some(last.as_ref().map_or(0.0, |b| b.innings_wickets) + 1.0),
                ),
                "MILESTONE_BAT" => (
                    js::trim(&format!("FIFTY! {}", bat.as_deref().unwrap_or(""))).to_string(),
                    Some("Raises the bat to the dressing room".into()),
                    Some(50.0),
                ),
                "MILESTONE_BOWL" => (
                    js::trim(&format!("FIVE-WICKET HAUL! {}", bowl.as_deref().unwrap_or(""))).to_string(),
                    Some("A spell to remember".into()),
                    Some(5.0),
                ),
                "PARTNERSHIP" => (
                    "50 PARTNERSHIP".into(),
                    Some(
                        [bat.clone(), non]
                            .into_iter()
                            .flatten()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(" & "),
                    ),
                    Some(50.0),
                ),
                "HATTRICK_WATCH" => (
                    "ON A HAT-TRICK!".into(),
                    Some(format!("{} — two in two", bowl.as_deref().unwrap_or("Bowler"))),
                    None,
                ),
                "OVER_END" => (
                    format!("End of over {}", num(over)),
                    Some(format!("{} runs", num(last.as_ref().map_or(0.0, |b| b.over_runs)))),
                    Some(over),
                ),
                "INNINGS_END" => ("Innings Break".into(), Some("Time for the experts".into()), None),
                "MATCH_END" => ("Match Over".into(), Some(d.as_ref().map_or_else(String::new, |m| m.summary.clone())), None),
                other => (other.to_string(), None, None),
            };
            let ev = CricketEvent {
                kind: kind.to_string(),
                match_key: g.state.match_key.clone().unwrap_or_else(|| "sim".into()),
                ball: last,
                title,
                subtitle,
                value,
                player: bat,
                ts: now_ms(),
            };
            self.emit_room("match:events", [&ev]);
            if g.automation.apply_event(&mut g.state, d.as_deref(), &ev) {
                self.commit(g);
            }
            ev
        };
        self.commentary_events(std::slice::from_ref(&ev));
        ev
    }

    pub fn dispose(&self) {
        {
            let mut g = self.lock();
            for t in g.timers.drain(..) {
                t.abort();
            }
            if let Some((sub, task)) = g.match_sub.take() {
                drop(sub);
                task.abort();
            }
            if let Some(p) = g.pipeline.take() {
                p.stop();
            }
            if let Some(c) = g.cloud.take() {
                c.stop();
            }
        }
        self.persist();
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentaryTest {
    pub ok: bool,
    pub text: String,
    pub ai: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub writer_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<Bytes>,
}

/* ---------------- manager ---------------- */

/// Lazily loads studios while anyone is connected; unloads idle ones.
pub struct Studios {
    pub svc: Arc<Services>,
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    pub loads: AtomicU64,
}

impl Studios {
    pub fn new(svc: Arc<Services>) -> Arc<Self> {
        Arc::new(Self {
            svc,
            rooms: Mutex::new(HashMap::new()),
            loads: AtomicU64::new(0),
        })
    }

    fn rooms(&self) -> MutexGuard<'_, HashMap<String, Arc<Room>>> {
        self.rooms.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn get(&self, id: &str) -> Option<Arc<Room>> {
        self.rooms().get(id).cloned()
    }

    pub fn load(&self, id: &str) -> anyhow::Result<Option<Arc<Room>>> {
        let mut rooms = self.rooms();
        if let Some(r) = rooms.get(id) {
            return Ok(Some(r.clone()));
        }
        let Some(rec) = self.svc.repo.get_studio(id)? else { return Ok(None) };
        let room = Room::new(rec, self.svc.clone());
        rooms.insert(id.to_string(), room.clone());
        self.loads.fetch_add(1, Ordering::Relaxed);
        Ok(Some(room))
    }

    pub fn maybe_unload(&self, id: &str) {
        let mut rooms = self.rooms();
        let Some(room) = rooms.get(id).cloned() else { return };
        let idle = {
            let g = room.lock();
            g.state.participants.is_empty() && !g.keep_alive()
        };
        if idle {
            rooms.remove(id);
            drop(rooms);
            room.dispose();
        }
    }

    pub fn suspend_all(&self) {
        let all: Vec<Arc<Room>> = self.rooms().values().cloned().collect();
        for r in all {
            r.suspend_live();
            r.persist();
        }
    }

    pub fn stats(&self) -> Value {
        let all: Vec<Arc<Room>> = self.rooms().values().cloned().collect();
        Value::Array(
            all.iter()
                .map(|r| {
                    let g = r.lock();
                    let dests: Vec<Value> = g
                        .state
                        .live
                        .destinations
                        .iter()
                        .map(|d| json!({ "name": d.name, "state": d.state, "retries": d.retries.unwrap_or(0), "error": d.error }))
                        .collect();
                    json!({
                        "id": g.state.id,
                        "participants": g.state.participants.len(),
                        "live": g.state.live.state,
                        "broadcaster": g.state.live.broadcaster,
                        "producer": g.cloud.as_ref().map_or(Value::Null, CloudProducer::health_json),
                        "producerRestarts": g.cloud.as_ref().map_or(0, CloudProducer::restarts),
                        "reconnects": g.state.live.reconnects.unwrap_or(0),
                        "destinations": dests,
                        "match": g.state.match_key,
                    })
                })
                .collect(),
        )
    }
}
