//! Environment configuration; same variables and defaults as the original server.

use std::env;
use std::path::{Path, PathBuf};

use base64::Engine;
use rand::RngCore;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub host: String,
    pub public_url: String,
    pub data_dir: PathBuf,
    pub web_dist: PathBuf,
    pub stream_key_secret: String,
    pub redis_url: String,
    pub database_url: String,
    pub media_mode: String,
    pub turn_url: String,
    pub turn_username: String,
    pub turn_credential: String,
    pub ffmpeg_path: String,
    pub streaming_disabled: bool,
    pub video_bitrate_kbps: f64,
    pub audio_bitrate_kbps: f64,
    pub x264_preset: String,
    pub encoder_x264: bool,
    pub poll_live_ms: u64,
    pub poll_idle_ms: u64,
    pub scorepanel_ttl_ms: u64,
    pub demo_ball_ms: u64,
    pub chrome_path: String,
    pub internal_web_url: String,
    pub worker_recycle_hours: f64,
    pub worker_max_heap_mb: f64,
    pub host_failover_ms: u64,
    pub tts_voice: String,
    pub worker_secret: String,
    pub production: bool,
}

fn var(k: &str) -> Option<String> {
    env::var(k).ok()
}

fn or(k: &str, d: &str) -> String {
    var(k).unwrap_or_else(|| d.to_string())
}

fn int(k: &str, d: f64) -> f64 {
    var(k)
        .filter(|v| !v.is_empty())
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|n| n.is_finite())
        .unwrap_or(d)
}

/// The checkout root: nearest ancestor holding `apps/server`, else the working directory.
fn repo_root() -> PathBuf {
    if let Some(r) = var("CRICSTUDIO_ROOT") {
        return PathBuf::from(r);
    }
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let found = cwd.ancestors().find(|p| p.join("apps").join("server").is_dir()).map(Path::to_path_buf);
    found.unwrap_or(cwd)
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let root = repo_root();
        for f in [root.join(".env"), root.join("apps").join("server").join(".env")] {
            if f.exists() {
                // malformed env files are ignored, as in the original
                let _ = dotenvy::from_path(&f);
            }
        }
        let web_port = int("WEB_PORT", 5180.0);
        let mut secret = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut secret);
        let data_dir = root.join(or("DATA_DIR", "data"));
        let web_dist = var("WEB_DIST").map_or_else(|| root.join("apps").join("web").join("dist"), PathBuf::from);
        std::fs::create_dir_all(data_dir.join("uploads"))?;
        Ok(Self {
            port: int("PORT", 8787.0) as u16,
            host: or("HOST", "0.0.0.0"),
            public_url: var("PUBLIC_URL").unwrap_or_else(|| format!("http://localhost:{web_port}")),
            data_dir,
            web_dist,
            stream_key_secret: or("STREAM_KEY_SECRET", ""),
            redis_url: var("REDIS_URL").filter(|v| !v.is_empty()).or_else(|| var("KV_URL")).unwrap_or_default(),
            database_url: or("DATABASE_URL", ""),
            media_mode: if var("MEDIA_MODE").as_deref() == Some("livekit") { "livekit" } else { "mesh" }.to_string(),
            turn_url: or("TURN_URL", ""),
            turn_username: or("TURN_USERNAME", ""),
            turn_credential: or("TURN_CREDENTIAL", ""),
            ffmpeg_path: or("FFMPEG_PATH", "ffmpeg"),
            streaming_disabled: var("STREAMING_DISABLED").as_deref() == Some("1"),
            video_bitrate_kbps: int("VIDEO_BITRATE_KBPS", 4500.0),
            audio_bitrate_kbps: int("AUDIO_BITRATE_KBPS", 160.0),
            x264_preset: or("X264_PRESET", "veryfast"),
            encoder_x264: var("ENCODER_MODE").as_deref() == Some("x264"),
            poll_live_ms: int("POLL_LIVE_MS", 6000.0) as u64,
            poll_idle_ms: int("POLL_IDLE_MS", 60000.0) as u64,
            scorepanel_ttl_ms: int("SCOREPANEL_TTL_MS", 20000.0) as u64,
            demo_ball_ms: int("DEMO_BALL_MS", 4500.0) as u64,
            chrome_path: or("CHROME_PATH", ""),
            internal_web_url: or("INTERNAL_WEB_URL", ""),
            worker_recycle_hours: int("WORKER_RECYCLE_HOURS", 6.0),
            worker_max_heap_mb: int("WORKER_MAX_HEAP_MB", 900.0),
            host_failover_ms: int("HOST_FAILOVER_MS", 8000.0) as u64,
            tts_voice: or("TTS_VOICE", "en-IN-PrabhatNeural"),
            worker_secret: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret),
            production: var("NODE_ENV").as_deref() == Some("production"),
        })
    }

    pub fn ice_servers(&self) -> serde_json::Value {
        let mut list = vec![serde_json::json!({ "urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] })];
        if !self.turn_url.is_empty() {
            list.push(serde_json::json!({ "urls": self.turn_url, "username": self.turn_username, "credential": self.turn_credential }));
        }
        serde_json::Value::Array(list)
    }
}
