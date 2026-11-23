//! The studio state broadcast to every browser.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::catalog;
use crate::store::StudioRecord;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Participant {
    pub id: String,
    pub name: String,
    pub role: String,
    pub on_stage: bool,
    pub muted: bool,
    pub cam_off: bool,
    pub screen_sharing: bool,
    pub joined_at: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DestinationStatus {
    pub id: String,
    pub platform: String,
    pub name: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retries: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<f64>,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broadcaster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconnects: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitrate_kbps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub destinations: Vec<DestinationStatus>,
}

impl Default for LiveStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            started_at: None,
            mode: "mesh".into(),
            broadcaster: None,
            reconnects: None,
            fps: None,
            bitrate_kbps: None,
            speed: None,
            error: None,
            destinations: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ActiveOverlay {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sfx: Option<String>,
    pub started_at: f64,
    pub until: f64,
    pub seq: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<u32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StudioState {
    pub id: String,
    pub name: String,
    pub match_key: Option<String>,
    pub participants: Vec<Participant>,
    pub scene: String,
    pub base_scene: String,
    pub scene_until: Option<f64>,
    pub overlay: Option<ActiveOverlay>,
    pub automation: String,
    pub rules: Value,
    pub pinned_until: f64,
    pub live: LiveStatus,
    pub music: Value,
    pub brand: Value,
    pub countdown_to: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub announcement: Option<Value>,
    /// undefined until first set; afterwards a banner or null
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner: Option<Value>,
    pub spotlight_id: Option<String>,
    pub autopilot: Value,
    pub stt: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_status: Option<Value>,
    pub transition: String,
    pub want_live: bool,
}

impl StudioState {
    pub fn ap_bool(&self, k: &str) -> bool {
        self.autopilot[k].as_bool().unwrap_or(false)
    }
    pub fn ap_num(&self, k: &str, d: f64) -> f64 {
        self.autopilot[k].as_f64().unwrap_or(d)
    }
    pub fn ap_str(&self, k: &str) -> Option<&str> {
        self.autopilot[k].as_str()
    }
    pub fn rule(&self, k: &str) -> bool {
        cricstudio_engine::js::truthy(&self.rules[k])
    }
    pub fn host(&self) -> Option<&Participant> {
        self.participants.iter().find(|p| p.role == "host")
    }
    pub fn guests(&self) -> usize {
        self.participants.iter().filter(|p| p.role == "guest").count()
    }
}

pub const PERSISTED: [&str; 13] = [
    "scene",
    "baseScene",
    "automation",
    "rules",
    "music",
    "brand",
    "countdownTo",
    "announcement",
    "banner",
    "spotlightId",
    "autopilot",
    "wantLive",
    "stt",
];

/// `{...a, ...b}` on two JSON objects.
pub fn spread(a: &Value, b: &Value) -> Value {
    let mut out = a.as_object().cloned().unwrap_or_default();
    if let Some(o) = b.as_object() {
        for (k, v) in o {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

pub fn default_state(rec: &StudioRecord, tts_voice: &str) -> StudioState {
    StudioState {
        id: rec.id.clone(),
        name: rec.name.clone(),
        match_key: rec.match_key.clone(),
        participants: Vec::new(),
        scene: "startingSoon".into(),
        base_scene: "startingSoon".into(),
        scene_until: None,
        overlay: None,
        automation: "auto".into(),
        rules: json!({ "wicket": true, "boundary": true, "overEnd": true, "milestones": true, "inningsBreak": true, "idleRotation": true, "idleSeconds": 75 }),
        pinned_until: 0.0,
        live: LiveStatus::default(),
        music: json!({ "track": "stadium-anthem", "playing": false, "volume": 0.35, "duck": true, "ambience": { "on": false, "volume": 0.3, "mood": "buzzing" } }),
        brand: json!({
            "title": rec.name,
            "ticker": "Welcome to the live cricket show! Drop your predictions in the chat 🏏",
            "accent": "#1a73e8",
            "showScorebug": true,
            "showTicker": true,
            "captions": false,
            "sfx": true,
            "sfxVolume": 0.8,
            "background": "stadiumNight",
            "transition": "mixed",
            "fontPair": "theme",
            "fx3d": true,
            "pollQuestion": "Who wins this match? Vote in the comments!",
            "camBubbles": false,
            "camBubblesAllScenes": true,
            "camBubbleCorner": "br",
            "camBubbleSize": 220,
            "camBubbleShape": "ball",
            "camBubbleSlots": {},
        }),
        countdown_to: None,
        announcement: None,
        banner: None,
        spotlight_id: None,
        autopilot: json!({
            "enabled": false,
            "sceneSeconds": 45,
            "scoreShare": 0.7,
            "includeCameras": false,
            "commentator": true,
            "voice": tts_voice,
            "chatterSeconds": 35,
            "autoMusic": true,
            "autoMatch": true,
            "cloud": false,
            "writer": "templates",
            "voiceEngine": "edge",
            "gnaniVoice": "Shubham",
            "commentaryLanguage": "en-IN",
        }),
        stt: json!({ "provider": "browser", "language": "en-IN", "geminiModel": "gemini-2.5-flash", "configured": { "gnani": false, "google": false, "gemini": false } }),
        ai_status: None,
        transition: "fadeZoom".into(),
        want_live: false,
    }
}

/// Default state overlaid with a studio's saved settings; also returns its encrypted STT keys.
pub fn restore_state(rec: &StudioRecord, tts_voice: &str) -> (StudioState, Map<String, Value>) {
    let base = default_state(rec, tts_voice);
    let saved: Value = serde_json::from_str(if rec.settings.is_empty() { "{}" } else { &rec.settings }).unwrap_or_else(|_| json!({}));
    let mut merged = match serde_json::to_value(&base) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    };
    for k in PERSISTED {
        if let Some(v) = saved.get(k) {
            merged.insert(k.to_string(), v.clone());
        }
    }
    merged.insert("rules".into(), spread(&base.rules, &saved["rules"]));
    let mut brand = spread(&base.brand, &saved["brand"]);
    let bg_ok = saved["brand"]["background"].as_str().is_some_and(|b| catalog::BACKGROUNDS.contains(&b));
    if !bg_ok {
        brand["background"] = base.brand["background"].clone();
    }
    merged.insert("brand".into(), brand);
    let mut music = spread(&base.music, &saved["music"]);
    music["playing"] = json!(false);
    merged.insert("music".into(), music);
    let mut autopilot = spread(&base.autopilot, &saved["autopilot"]);
    if saved["autopilot"]["sceneSeconds"].as_f64() == Some(8.0) {
        autopilot["sceneSeconds"] = json!(45); // the old default
    }
    merged.insert("autopilot".into(), autopilot);
    merged.insert("stt".into(), spread(&base.stt, &saved["stt"]));
    let mut st: StudioState = serde_json::from_value(Value::Object(merged)).unwrap_or_else(|_| base.clone());
    let mut keys = Map::new();
    for p in crate::speech::CLOUD_STT {
        if let Some(k) = saved["sttKeys"][p].as_str().filter(|k| !k.is_empty()) {
            keys.insert(p.to_string(), json!(k));
        }
    }
    st.stt["configured"] = json!({ "gnani": keys.contains_key("gnani"), "google": keys.contains_key("google"), "gemini": keys.contains_key("gemini") });
    st.scene_until = None;
    if st.scene != st.base_scene {
        st.scene = st.base_scene.clone();
    }
    (st, keys)
}
