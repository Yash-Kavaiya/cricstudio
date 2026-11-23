//! The realtime protocol the browser speaks, event for event (port of `socket.ts`).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use cricstudio_engine::bubbles::{apply_bubble_patch, can_edit_bubble, sanitize_bubble_fields};
use cricstudio_engine::js::{self, now_ms, to_number};
use cricstudio_engine::CricketEvent;
use rand::Rng;
use serde_json::{json, Value};
use socketioxide::extract::{AckSender, Data, SocketRef};

use crate::automation::pick_transition;
use crate::catalog;
use crate::crypto::token_matches;
use crate::room::{Room, Studios};
use crate::speech::{slice_last_units, slice_units, CLOUD_STT};
use crate::state::{spread, Participant};

const MAX_GUESTS: usize = 4;

/// Per-socket token bucket: `burst` events at once, refilling at `per_sec`.
pub struct RateLimiter {
    per_sec: f64,
    burst: f64,
    tokens: f64,
    last: f64,
}

impl RateLimiter {
    pub fn new(per_sec: f64, burst: f64, now: f64) -> Self {
        Self {
            per_sec,
            burst,
            tokens: burst,
            last: now,
        }
    }

    pub fn allow(&mut self, now: f64) -> bool {
        self.tokens = (self.tokens + (now - self.last) / 1000.0 * self.per_sec).min(self.burst);
        self.last = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

struct SocketData {
    studio_id: Option<String>,
    role: Option<String>,
    name: Option<String>,
    producer: bool,
    chat: RateLimiter,
    update: RateLimiter,
    tts: RateLimiter,
    last_caption: f64,
    stt_busy: bool,
}

#[derive(Clone)]
struct Conn {
    studios: Arc<Studios>,
    data: Arc<Mutex<SocketData>>,
    sid: String,
}

impl Conn {
    fn d(&self) -> std::sync::MutexGuard<'_, SocketData> {
        self.data.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn room(&self) -> Option<Arc<Room>> {
        let id = self.d().studio_id.clone()?;
        self.studios.get(&id)
    }

    fn host_room(&self) -> Option<Arc<Room>> {
        let is_host = self.d().role.as_deref() == Some("host");
        self.room().filter(|_| is_host)
    }

    fn is_producer(&self, r: &Room) -> bool {
        let g = r.lock();
        let d = self.d();
        g.is_live()
            && ((g.state.live.broadcaster.as_deref() == Some("host") && d.role.as_deref() == Some("host"))
                || (g.state.live.broadcaster.as_deref() == Some("cloud") && d.producer))
    }

    fn display_name(&self) -> String {
        self.d().name.clone().unwrap_or_default()
    }
}

fn reply(ack: AckSender, v: Value) {
    let _ = ack.send(&v);
}

fn clamp_num(v: Option<&Value>, lo: f64, hi: f64, d: f64) -> f64 {
    let n = to_number(v);
    if n.is_finite() {
        n.min(hi).max(lo)
    } else {
        d
    }
}

fn sanitize_autopilot(cur: &Value, p: &Value) -> Value {
    let flag = |k: &str| p[k].as_bool().map_or_else(|| cur[k].clone(), Value::Bool);
    let cur_num = |k: &str, d: f64| cur[k].as_f64().unwrap_or(d);
    let pick = |k: &str, ok: &dyn Fn(&str) -> bool, d: &str| match p[k].as_str().filter(|v| !v.is_empty() && ok(v)) {
        Some(v) => json!(v),
        None => {
            if cur[k].is_null() {
                json!(d)
            } else {
                cur[k].clone()
            }
        }
    };
    let scene = match p.get("sceneSeconds") {
        Some(v) => js::round(clamp_num(Some(v), 5.0, 600.0, cur_num("sceneSeconds", 45.0))),
        None => cur_num("sceneSeconds", 45.0),
    };
    let share = match p.get("scoreShare") {
        Some(v) => clamp_num(Some(v), 0.0, 1.0, cur_num("scoreShare", 0.7)),
        None => cur_num("scoreShare", 0.7),
    };
    let chatter = match p.get("chatterSeconds") {
        Some(v) => clamp_num(Some(v), 15.0, 180.0, cur_num("chatterSeconds", 35.0)),
        None => cur_num("chatterSeconds", 35.0),
    };
    let voice = p["voice"]
        .as_str()
        .filter(|v| catalog::VOICES.contains(v))
        .map_or_else(|| cur["voice"].clone(), |v| json!(v));
    json!({
        "enabled": flag("enabled"),
        "sceneSeconds": scene,
        "scoreShare": share,
        "includeCameras": flag("includeCameras"),
        "commentator": flag("commentator"),
        "voice": voice,
        "chatterSeconds": chatter,
        "autoMusic": flag("autoMusic"),
        "autoMatch": flag("autoMatch"),
        "cloud": flag("cloud"),
        "writer": pick("writer", &|v| v == "gemini" || v == "templates", "templates"),
        "voiceEngine": pick("voiceEngine", &|v| v == "gnani" || v == "edge", "edge"),
        "gnaniVoice": pick("gnaniVoice", &|v| catalog::GNANI_VOICES.contains(&v), "Shubham"),
        "commentaryLanguage": pick("commentaryLanguage", &|v| catalog::STT_LANGUAGES.contains(&v), "en-IN"),
    })
}

fn sanitize_brand(cur: &Value, patch: &Value) -> Value {
    let mut b = spread(cur, patch);
    if !b["background"].as_str().is_some_and(|x| catalog::BACKGROUNDS.contains(&x)) {
        b["background"] = cur["background"].clone();
    }
    if b["transition"].as_str() != Some("mixed") && !b["transition"].as_str().is_some_and(|x| catalog::TRANSITIONS.contains(&x)) {
        b["transition"] = cur["transition"].clone();
    }
    if js::truthy(&b["fontPair"]) && !b["fontPair"].as_str().is_some_and(|x| catalog::FONT_PAIRS.contains(&x)) {
        b["fontPair"] = if cur["fontPair"].is_null() { json!("theme") } else { cur["fontPair"].clone() };
    }
    let or = |k: &str, d: Value| if cur[k].is_null() { d } else { cur[k].clone() };
    let prev = json!({
        "camBubbles": js::truthy(&cur["camBubbles"]),
        "camBubblesAllScenes": cur["camBubblesAllScenes"] != Value::Bool(false),
        "camBubbleCorner": or("camBubbleCorner", json!("br")),
        "camBubbleSize": or("camBubbleSize", json!(220)),
        "camBubbleShape": or("camBubbleShape", json!("ball")),
        "camBubbleSlots": or("camBubbleSlots", json!({})),
    });
    let frames = sanitize_bubble_fields(&b, &prev);
    let sponsors: Vec<Value> = b["sponsors"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| slice_units(js::trim(&js::to_string(x)), 90))
                .filter(|s| !s.is_empty())
                .take(12)
                .map(Value::String)
                .collect()
        })
        .unwrap_or_default();
    b["sponsors"] = Value::Array(sponsors);
    spread(&b, &frames)
}

fn apply_patch(r: &Arc<Room>, patch: &Value) {
    let mut intro = false;
    let mut auto_match = false;
    let mut countdown = false;
    {
        let mut guard = r.lock();
        let g = &mut *guard;
        let s = &mut g.state;
        if let Some(a) = patch["automation"].as_str().filter(|a| ["auto", "assist", "manual"].contains(a)) {
            s.automation = a.to_string();
        }
        if js::truthy(&patch["rules"]) {
            s.rules = spread(&s.rules, &patch["rules"]);
        }
        if js::truthy(&patch["music"]) {
            // a person pressing Stop must win over the autopilot's music bed
            if patch["music"]["playing"] == Value::Bool(false) && js::truthy(&s.music["playing"]) && s.ap_bool("autoMusic") {
                s.autopilot["autoMusic"] = json!(false);
            }
            s.music = spread(&s.music, &patch["music"]);
        }
        if js::truthy(&patch["brand"]) {
            s.brand = sanitize_brand(&s.brand, &patch["brand"]);
        }
        if js::truthy(&patch["autopilot"]) {
            let was = s.ap_bool("enabled");
            let ai_sig = |x: &crate::state::StudioState| format!("{:?}|{:?}", x.autopilot["writer"], x.autopilot["voiceEngine"]);
            let prev = ai_sig(s);
            s.autopilot = sanitize_autopilot(&s.autopilot, &patch["autopilot"]);
            if ai_sig(s) != prev {
                s.ai_status = None;
            }
            let enabled = s.ap_bool("enabled");
            if was && !enabled && js::truthy(&s.music["playing"]) && s.ap_bool("autoMusic") {
                s.music["playing"] = json!(false);
            }
            g.automation.refresh_playlist();
            if !was && enabled {
                intro = true;
                auto_match = true;
            }
        }
        let s = &mut g.state;
        if let Some(c) = patch.get("countdownTo") {
            s.countdown_to = c.as_f64();
            countdown = js::truthy(c);
        }
        if let Some(b) = patch.get("banner") {
            s.banner = Some(match b["kind"].as_str() {
                Some(kind @ ("sponsor" | "quickScore")) => json!({ "kind": kind, "since": now_ms() }),
                _ => Value::Null,
            });
        }
        if let Some(sp) = patch.get("spotlightId") {
            s.spotlight_id = sp.as_str().map(str::to_string);
        }
        if let Some(n) = patch["name"].as_str().map(js::trim).filter(|n| !n.is_empty()) {
            s.name = slice_units(n, 80);
        }
        if let Some(k) = patch.get("matchKey") {
            let key = k.as_str().map(str::to_string);
            if key != g.state.match_key {
                r.set_match_locked(g, key);
            }
        }
        countdown = countdown && g.latest.is_some();
        r.commit(g);
    }
    if intro {
        r.commentary_intro();
    }
    if auto_match {
        let room = r.clone();
        tokio::spawn(async move { room.auto_match(true).await });
    }
    if countdown {
        r.commentary_countdown();
    }
}

async fn join(c: &Conn, s: &SocketRef, req: Value, ack: AckSender) {
    let studio_id = req["studioId"].as_str().unwrap_or("").to_string();
    let token = req["token"].as_str().unwrap_or("").to_string();
    let role = req["role"].as_str().unwrap_or("").to_string();
    let r = match c.studios.load(&studio_id) {
        Ok(Some(r)) => r,
        Ok(None) => return reply(ack, json!({ "ok": false, "error": "Studio not found" })),
        Err(e) => return reply(ack, json!({ "ok": false, "error": e.to_string() })),
    };
    let rec = &r.record;
    let cfg = &r.svc.cfg;
    let is_worker = role == "program" && token == cfg.worker_secret;
    let hash = match role.as_str() {
        "host" => &rec.host_token_hash,
        "guest" => &rec.guest_token_hash,
        _ => &rec.program_token_hash,
    };
    let valid = is_worker || token_matches(&token, hash) || (role == "program" && token_matches(&token, &rec.host_token_hash));
    if !valid {
        return reply(ack, json!({ "ok": false, "error": "Invalid or expired link" }));
    }
    if role == "guest" && r.lock().state.guests() >= MAX_GUESTS {
        return reply(
            ack,
            json!({ "ok": false, "error": format!("This studio is full — max {MAX_GUESTS} guest speakers + 1 host.") }),
        );
    }
    if role == "host" {
        let prev = {
            let mut g = r.lock();
            let prev = g.state.host().map(|h| h.id.clone()).filter(|id| *id != c.sid);
            if let Some(id) = &prev {
                g.state.participants.retain(|p| p.id != *id);
            }
            if let Some(t) = g.host_left.take() {
                t.abort();
            }
            prev
        };
        if let Some(id) = prev {
            // sent directly: the queued outbox could lose the race with the disconnect
            if let Some(old) = id.parse().ok().and_then(|sid| r.svc.io.get_socket(sid)) {
                let _ = old.emit("studio:replaced", &());
                let _ = old.disconnect();
            }
        }
        // server restarted mid-show: pick the stream back up once the host is in the room
        let (room, sid) = (r.clone(), c.sid.clone());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            room.resume_host_stream(&sid);
        });
    }
    let name = req["name"]
        .as_str()
        .filter(|n| !n.is_empty())
        .map_or_else(|| if role == "host" { "Host".to_string() } else { "Guest".to_string() }, |n| slice_units(n, 40));
    {
        let mut d = c.d();
        d.studio_id = Some(r.id.clone());
        d.role = Some(role.clone());
        d.producer = is_worker;
        d.name = Some(name.clone());
    }
    let p = Participant {
        id: c.sid.clone(),
        name: if is_worker { "Cloud producer".into() } else { name },
        on_stage: role == "host",
        role: role.clone(),
        muted: false,
        cam_off: false,
        screen_sharing: false,
        joined_at: now_ms(),
    };
    s.join(r.room_name.clone());
    let _ = s.to(r.room_name.clone()).emit("peer:joined", &p).await;
    let (state, media, latest, chat) = {
        let mut g = r.lock();
        g.state.participants.push(p);
        g.state.live.mode = "mesh".into();
        g.automation.refresh_playlist();
        r.commit(&mut g);
        let from = g.chat.len().saturating_sub(50);
        (
            serde_json::to_value(&g.state).unwrap_or(Value::Null),
            g.state.live.mode.clone(),
            g.latest.clone(),
            g.chat[from..].to_vec(),
        )
    };
    reply(
        ack,
        json!({ "ok": true, "selfId": c.sid, "state": state, "iceServers": cfg.ice_servers(), "mediaMode": media }),
    );
    if let Some(m) = latest {
        let _ = s.emit("match:update", &*m);
    }
    let _ = s.emit("chat:history", &chat);
    if is_worker {
        r.on_producer_joined(&c.sid);
    }
    let resume = role == "host" && {
        let g = r.lock();
        g.is_live() && g.state.live.broadcaster.as_deref() == Some("host")
    };
    if resume {
        let _ = s.emit("producer:start", &());
    }
}

fn on_disconnect(c: &Conn, s: &SocketRef) {
    let Some(r) = c.room() else { return };
    {
        let mut g = r.lock();
        g.state.participants.retain(|p| p.id != c.sid);
        if g.state.spotlight_id.as_deref() == Some(c.sid.as_str()) {
            g.state.spotlight_id = None;
        }
        if g.producer_id.as_deref() == Some(c.sid.as_str()) {
            g.producer_id = None;
        }
        g.automation.refresh_playlist();
        r.commit(&mut g);
    }
    let (out, room, sid) = (s.clone(), r.room_name.clone(), c.sid.clone());
    tokio::spawn(async move {
        let _ = out.to(room).emit("peer:left", &sid).await;
    });
    if c.d().role.as_deref() == Some("host") {
        r.schedule_failover();
    }
    let (studios, id) = (c.studios.clone(), r.id.clone());
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        studios.maybe_unload(&id);
    });
}

/// Register a host-only event: anyone else gets `{ok:false, error:'Host only'}`.
macro_rules! host_on {
    ($s:expr, $c:expr, $name:literal, |$room:ident, $v:ident, $conn:ident, $sock:ident| $body:expr) => {{
        let conn = $c.clone();
        $s.on($name, move |$sock: SocketRef, Data($v): Data<Value>, ack: AckSender| {
            let $conn = conn.clone();
            async move {
                let Some($room) = $conn.host_room() else {
                    return reply(ack, json!({ "ok": false, "error": "Host only" }));
                };
                let result: Result<Value, String> = $body;
                reply(ack, result.unwrap_or_else(|e| json!({ "ok": false, "error": e })));
            }
        });
    }};
}

// Order-sensitive events (media chunks, WebRTC signals, chat) do their work in the handler call
// and return a ready future: the library spawns the returned future as a separate task, so work
// inside it could run out of order.
pub fn on_connect(s: SocketRef, studios: Arc<Studios>) {
    let now = now_ms();
    let c = Conn {
        studios,
        sid: s.id.to_string(),
        data: Arc::new(Mutex::new(SocketData {
            studio_id: None,
            role: None,
            name: None,
            producer: false,
            chat: RateLimiter::new(1.0, 5.0, now),
            update: RateLimiter::new(10.0, 20.0, now),
            tts: RateLimiter::new(2.0, 6.0, now),
            last_caption: 0.0,
            stt_busy: false,
        })),
    };

    {
        let conn = c.clone();
        s.on("studio:join", move |sock: SocketRef, Data(req): Data<Value>, ack: AckSender| {
            let conn = conn.clone();
            async move { join(&conn, &sock, req, ack).await }
        });
    }
    {
        let conn = c.clone();
        s.on_disconnect(move |sock: SocketRef| {
            let conn = conn.clone();
            async move { on_disconnect(&conn, &sock) }
        });
    }

    /* ---------------- host controls ---------------- */

    host_on!(s, c, "studio:scene", |r, v, _c, _s| {
        let scene = v["scene"].as_str().unwrap_or("");
        if catalog::scene(scene).is_none() {
            Err("Unknown scene".to_string())
        } else {
            let pin = v["pinSeconds"].as_f64().unwrap_or(30.0);
            let mut guard = r.lock();
            let g = &mut *guard;
            if g.state.scene != scene {
                g.state.transition = pick_transition(&g.state, Some(&g.state.transition));
            }
            g.state.scene = scene.to_string();
            g.state.base_scene = scene.to_string();
            g.state.scene_until = None;
            g.state.pinned_until = now_ms() + pin * 1000.0;
            g.automation.note_manual_scene();
            r.commit(g);
            Ok(json!({ "ok": true }))
        }
    });

    host_on!(s, c, "studio:announce", |r, a, _c, _s| {
        if a.is_null() {
            let mut g = r.lock();
            g.state.announcement = None;
            r.commit(&mut g);
            Ok(json!({ "ok": true }))
        } else {
            let text_of = |k: &str, n: usize| slice_units(js::trim(&js::str_of(&a[k])), n);
            let (title, text) = (text_of("title", 60), text_of("text", 400));
            if title.is_empty() && text.is_empty() {
                Err("Type a message first".to_string())
            } else {
                {
                    let mut guard = r.lock();
                    let g = &mut *guard;
                    g.state.announcement = Some(json!({ "title": title, "text": text, "ts": now_ms() }));
                    if a["show"] != Value::Bool(false) && g.state.scene != "message" {
                        g.state.transition = pick_transition(&g.state, Some(&g.state.transition));
                        g.state.scene = "message".into();
                        g.state.base_scene = "message".into();
                        g.state.scene_until = None;
                        g.state.pinned_until = now_ms() + 30_000.0;
                        g.automation.note_manual_scene();
                    }
                    r.commit(g);
                }
                if js::truthy(&a["speak"]) {
                    let parts: Vec<&str> = [title.as_str(), text.as_str()].into_iter().filter(|x| !x.is_empty()).collect();
                    r.announce(parts.join(". "));
                }
                Ok(json!({ "ok": true }))
            }
        }
    });

    host_on!(s, c, "studio:overlay", |r, o, _c, _s| {
        let mut guard = r.lock();
        let g = &mut *guard;
        if o.is_null() {
            g.state.overlay = None;
        } else {
            let id = o["id"].as_str().unwrap_or("custom");
            let ms = o["ms"].as_f64().unwrap_or(6000.0).min(60000.0);
            g.automation.show_overlay(
                &mut g.state,
                id,
                js::str_of(&o["title"]),
                o["subtitle"].as_str().map(str::to_string),
                o["sfx"].as_str().map(str::to_string),
                ms,
            );
        }
        r.commit(g);
        Ok(json!({ "ok": true }))
    });

    host_on!(s, c, "studio:patch", |r, patch, _c, _s| {
        apply_patch(&r, &patch);
        Ok(json!({ "ok": true }))
    });

    {
        let conn = c.clone();
        s.on("studio:bubble", move |Data(body): Data<Value>, ack: AckSender| {
            let conn = conn.clone();
            async move {
                let Some(r) = conn.room() else { return reply(ack, json!({ "ok": false })) };
                if !conn.d().update.allow(now_ms()) {
                    return reply(ack, json!({ "ok": false, "error": "Too many updates — slow down" }));
                }
                let id = if body["participantId"].is_null() {
                    String::new()
                } else {
                    js::to_string(&body["participantId"])
                };
                let mut guard = r.lock();
                let g = &mut *guard;
                let me = g.state.participants.iter().find(|p| p.id == conn.sid).cloned();
                if !me.is_some_and(|m| can_edit_bubble(Some(&m.role), &m.id, &id)) {
                    return reply(ack, json!({ "ok": false, "error": "You can only move your own frame" }));
                }
                if !g.state.participants.iter().any(|p| p.id == id && p.role != "program") {
                    return reply(ack, json!({ "ok": false, "error": "Not on this show" }));
                }
                let p = &body["patch"];
                let mut clean = serde_json::Map::new();
                for k in ["x", "y", "shape"] {
                    if let Some(v) = p.get(k) {
                        clean.insert(k.to_string(), v.clone());
                    }
                }
                clean.insert("clearPosition".into(), json!(js::truthy(&p["clearPosition"])));
                clean.insert("clear".into(), json!(js::truthy(&p["clear"])));
                let slots = apply_bubble_patch(g.state.brand["camBubbleSlots"].as_object(), &id, &Value::Object(clean));
                g.state.brand["camBubbleSlots"] = Value::Object(slots);
                r.commit(g);
                reply(ack, json!({ "ok": true }));
            }
        });
    }

    host_on!(s, c, "studio:stage", |r, v, _c, _s| {
        let id = v["participantId"].as_str().unwrap_or("");
        let mut guard = r.lock();
        let g = &mut *guard;
        match g.state.participants.iter_mut().find(|p| p.id == id && p.role != "program") {
            None => Err("Not found".to_string()),
            Some(p) => {
                p.on_stage = js::truthy(&v["onStage"]);
                g.automation.refresh_playlist();
                r.commit(g);
                Ok(json!({ "ok": true }))
            }
        }
    });

    host_on!(s, c, "studio:kick", |r, v, conn, _sock| {
        let id = v["participantId"].as_str().unwrap_or("");
        let in_room = r.lock().state.participants.iter().any(|p| p.id == id);
        if in_room && id != conn.sid {
            if let Some(target) = id.parse().ok().and_then(|sid| r.svc.io.get_socket(sid)) {
                let _ = target.emit("studio:kicked", &());
                let _ = target.disconnect();
            }
        }
        Ok(json!({ "ok": true }))
    });

    host_on!(s, c, "participant:muteRequest", |r, v, _c, _s| {
        let id = v["participantId"].as_str().unwrap_or("").to_string();
        let exists = r.lock().state.participants.iter().any(|p| p.id == id);
        if exists {
            r.emit_to(&id, "participant:muteRequest", ());
        }
        Ok(json!({ "ok": true }))
    });

    host_on!(s, c, "automation:accept", |r, v, _c, _s| {
        match serde_json::from_value::<CricketEvent>(v["event"].clone()) {
            Err(e) => Err(e.to_string()),
            Ok(ev) => {
                let mut guard = r.lock();
                let g = &mut *guard;
                let latest = g.latest.clone();
                if g.automation.apply_event(&mut g.state, latest.as_deref(), &ev) {
                    r.commit(g);
                }
                Ok(json!({ "ok": true }))
            }
        }
    });

    host_on!(s, c, "dev:simulate", |r, v, _c, _s| {
        let ev = r.simulate(v["type"].as_str().unwrap_or(""));
        Ok(json!({ "ok": true, "event": ev }))
    });

    host_on!(s, c, "demo:step", |r, v, _c, _s| {
        let n = v["n"].as_f64().unwrap_or(1.0).clamp(1.0, 30.0);
        r.svc.hub.demo_step(n as u32);
        Ok(json!({ "ok": true }))
    });

    host_on!(s, c, "commentary:say", |r, v, _c, _s| {
        let t = slice_units(js::trim(&js::str_of(&v["text"])), 300);
        if !t.is_empty() {
            r.speak_text(t, 3, None);
        }
        Ok(json!({ "ok": true }))
    });

    /* ---------------- participants ---------------- */

    {
        let conn = c.clone();
        s.on("participant:update", move |Data(patch): Data<Value>| {
            (|| {
                let Some(r) = conn.room() else { return };
                let mut guard = r.lock();
                let g = &mut *guard;
                let Some(p) = g.state.participants.iter_mut().find(|p| p.id == conn.sid) else {
                    return;
                };
                if !conn.d().update.allow(now_ms()) {
                    return;
                }
                if let Some(v) = patch["muted"].as_bool() {
                    p.muted = v;
                }
                if let Some(v) = patch["camOff"].as_bool() {
                    p.cam_off = v;
                }
                if let Some(v) = patch["screenSharing"].as_bool() {
                    p.screen_sharing = v;
                }
                if let Some(n) = patch["name"].as_str().map(js::trim).filter(|n| !n.is_empty()) {
                    p.name = slice_units(n, 40);
                }
                r.commit(g);
            })();
            std::future::ready(())
        });
    }

    {
        let conn = c.clone();
        s.on("rtc:signal", move |Data(msg): Data<Value>| {
            (|| {
                let Some(r) = conn.room() else { return };
                let Some(to) = msg["to"].as_str().filter(|t| !t.is_empty()) else { return };
                // only people in this studio can be signalled
                if r.lock().state.participants.iter().any(|p| p.id == to) {
                    r.emit_to(to, "rtc:signal", json!({ "from": conn.sid, "data": msg["data"] }));
                }
            })();
            std::future::ready(())
        });
    }

    {
        let conn = c.clone();
        s.on("chat:send", move |Data(body): Data<Value>| {
            (|| {
                let Some(r) = conn.room() else { return };
                let Some(text) = body["text"].as_str().map(js::trim).filter(|t| !t.is_empty()) else {
                    return;
                };
                let (from, role) = {
                    let mut d = conn.d();
                    if d.role.as_deref() == Some("program") || !d.chat.allow(now_ms()) {
                        return;
                    }
                    (
                        d.name.clone().unwrap_or_else(|| "Anon".into()),
                        d.role.clone().unwrap_or_else(|| "guest".into()),
                    )
                };
                let ts = now_ms();
                let tag: u32 = rand::thread_rng().gen_range(0..1_679_616);
                let msg = json!({ "id": format!("{}-{tag:x}", js::num_str(ts)), "from": from, "role": role, "text": slice_units(text, 500), "ts": ts });
                {
                    let mut g = r.lock();
                    g.chat.push(msg.clone());
                    if g.chat.len() > 200 {
                        g.chat.remove(0);
                    }
                }
                r.emit_room("chat:msg", msg);
            })();
            std::future::ready(())
        });
    }

    {
        let conn = c.clone();
        s.on("captions:text", move |Data(body): Data<Value>| {
            (|| {
                let Some(r) = conn.room() else { return };
                if !js::truthy(&body["text"]) {
                    return;
                }
                let now = now_ms();
                let is_final = js::truthy(&body["final"]);
                {
                    let mut d = conn.d();
                    if !is_final && now - d.last_caption < 250.0 {
                        return;
                    }
                    d.last_caption = now;
                }
                let text = slice_last_units(&js::to_string(&body["text"]), 200);
                r.emit_room(
                    "captions:text",
                    json!({ "from": conn.display_name(), "text": text, "final": is_final, "ts": now }),
                );
            })();
            std::future::ready(())
        });
    }

    {
        let conn = c.clone();
        s.on("stt:segment", move |Data(audio): Data<Bytes>, ack: AckSender| {
            let conn = conn.clone();
            async move {
                let room = conn.room().filter(|r| {
                    let g = r.lock();
                    g.state.participants.iter().any(|p| p.id == conn.sid)
                        && js::truthy(&g.state.brand["captions"])
                        && g.state.stt["provider"].as_str() != Some("browser")
                });
                let Some(r) = room else {
                    return reply(ack, json!({ "ok": false, "error": "Cloud captions off" }));
                };
                if audio.len() < 1000 || audio.len() > 2_000_000 {
                    return reply(ack, json!({ "ok": false, "error": "Bad audio size" }));
                }
                {
                    let mut d = conn.d();
                    if d.stt_busy {
                        return reply(ack, json!({ "ok": false, "error": "busy" }));
                    }
                    d.stt_busy = true;
                }
                let result = r.transcribe(&audio).await;
                conn.d().stt_busy = false;
                match result {
                    Ok((text, provider)) => {
                        if !text.is_empty() {
                            r.emit_room(
                                "captions:text",
                                json!({ "from": conn.display_name(), "text": slice_last_units(&text, 200), "final": true, "ts": now_ms() }),
                            );
                        }
                        reply(ack, json!({ "ok": true, "text": text, "provider": provider }));
                    }
                    Err(e) => reply(ack, json!({ "ok": false, "error": e.to_string() })),
                }
            }
        });
    }

    {
        let conn = c.clone();
        s.on("commentary:tts", move |Data(body): Data<Value>, ack: AckSender| {
            let conn = conn.clone();
            async move {
                #[derive(serde::Serialize)]
                struct Audio {
                    ok: bool,
                    audio: Bytes,
                }
                let id = body["id"].as_str().map(str::to_string);
                let allowed = conn.d().tts.allow(now_ms());
                let (Some(r), Some(id), true) = (conn.room(), id, allowed) else {
                    return reply(ack, json!({ "ok": false }));
                };
                match r.tts_line(&id).await {
                    Some(audio) => {
                        let _ = ack.send(&Audio { ok: true, audio });
                    }
                    None => reply(ack, json!({ "ok": false })),
                }
            }
        });
    }

    host_on!(s, c, "stt:save", |r, p, _c, _s| Ok(json!({ "ok": true, "stt": r.set_stt(&p) })));

    host_on!(s, c, "stt:test", |r, p, _c, _s| {
        match p["provider"].as_str().filter(|x| CLOUD_STT.contains(x)) {
            None => Ok(json!({ "ok": false, "error": "Unknown provider", "ms": 0 })),
            Some(provider) => Ok(r.test_stt(provider, p["key"].as_str()).await),
        }
    });

    {
        let conn = c.clone();
        s.on("commentary:test", move |Data(_p): Data<Value>, ack: AckSender| {
            let conn = conn.clone();
            async move {
                let Some(r) = conn.host_room() else {
                    return reply(ack, json!({ "ok": false, "error": "Host only" }));
                };
                let t = r.test_commentary().await;
                let _ = ack.send(&t);
            }
        });
    }

    {
        let conn = c.clone();
        s.on("livekit:token", move |ack: AckSender| {
            let _ = &conn;
            async move { reply(ack, json!({ "ok": false, "error": "LiveKit disabled" })) }
        });
    }

    /* ---------------- going live ---------------- */

    host_on!(s, c, "stream:start", |r, opts, _c, _s| {
        let broadcaster = if opts["broadcaster"].as_str() == Some("cloud") { "cloud" } else { "host" };
        Ok(match r.start_live(broadcaster) {
            Ok(()) => json!({ "ok": true, "mode": "mesh", "broadcaster": broadcaster }),
            Err(e) => json!({ "ok": false, "error": e, "mode": "mesh", "broadcaster": broadcaster }),
        })
    });

    {
        let conn = c.clone();
        s.on("ingest:reset", move |Data(info): Data<Value>| {
            (|| {
                let Some(r) = conn.room() else { return };
                if conn.is_producer(&r) {
                    let p = r.lock().pipeline.clone();
                    if let Some(p) = p {
                        p.reset_ingest(info["mime"].as_str().map(str::to_string));
                    }
                }
            })();
            std::future::ready(())
        });
    }

    {
        let conn = c.clone();
        s.on("ingest:chunk", move |Data(chunk): Data<Bytes>| {
            (|| {
                let Some(r) = conn.room() else { return };
                if conn.is_producer(&r) {
                    let p = r.lock().pipeline.clone();
                    if let Some(p) = p {
                        p.write(chunk);
                    }
                }
            })();
            std::future::ready(())
        });
    }

    {
        let conn = c.clone();
        s.on("producer:heartbeat", move |Data(h): Data<Value>| {
            (|| {
                let Some(r) = conn.room() else { return };
                if conn.d().producer {
                    if let Some(cloud) = &r.lock().cloud {
                        cloud.heartbeat(js::num(&h["fps"]), js::num(&h["heapMb"]));
                    }
                }
            })();
            std::future::ready(())
        });
    }

    host_on!(s, c, "stream:stop", |r, _opts, _c, _s| {
        r.stop_live();
        Ok(json!({ "ok": true }))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_bursts_then_refills() {
        let mut l = RateLimiter::new(1.0, 2.0, 0.0);
        assert!(l.allow(0.0));
        assert!(l.allow(0.0));
        assert!(!l.allow(0.0));
        assert!(l.allow(1000.0));
        assert!(!l.allow(1000.0));
    }

    #[test]
    fn autopilot_values_are_clamped_and_validated() {
        let cur = json!({ "enabled": false, "sceneSeconds": 45, "scoreShare": 0.7, "voice": "en-GB-RyanNeural", "chatterSeconds": 35 });
        let next = sanitize_autopilot(
            &cur,
            &json!({ "sceneSeconds": 1, "scoreShare": 5, "voice": "evil", "chatterSeconds": 999, "writer": "nope" }),
        );
        assert_eq!(next["sceneSeconds"], json!(5.0));
        assert_eq!(next["scoreShare"], json!(1.0));
        assert_eq!(next["voice"], json!("en-GB-RyanNeural"));
        assert_eq!(next["chatterSeconds"], json!(180.0));
        assert_eq!(next["writer"], json!("templates"));
    }

    #[test]
    fn brand_rejects_unknown_ids_and_caps_sponsors() {
        let cur = json!({ "background": "stadiumNight", "transition": "mixed", "fontPair": "theme" });
        let next = sanitize_brand(
            &cur,
            &json!({ "background": "nope", "transition": "nope", "fontPair": "nope", "sponsors": ["  A ", "", 5] }),
        );
        assert_eq!(next["background"], "stadiumNight");
        assert_eq!(next["transition"], "mixed");
        assert_eq!(next["fontPair"], "theme");
        assert_eq!(next["sponsors"], json!(["A", "5"]));
    }
}
