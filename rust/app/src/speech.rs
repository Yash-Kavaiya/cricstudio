//! Outbound speech and language services: Edge TTS, Gemini, Gnani, translation, speech-to-text.

use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use bytes::Bytes;
use cricstudio_engine::js::{self, now_ms};
use cricstudio_engine::media::{speakable, target_code};
use futures_util::{SinkExt, StreamExt};
use regex::Regex;
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::catalog;

const EDGE_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_WSS: &str = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const EDGE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const EDGE_ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const TTS_MAX_BYTES: usize = 24 * 1024 * 1024;

/// JavaScript `slice(0, n)` on UTF-16 units.
pub fn slice_units(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n + 1).collect();
    if units.len() <= n {
        return s.to_string();
    }
    String::from_utf16_lossy(&units[..n])
}

/// JavaScript `slice(-n)` on UTF-16 units.
pub fn slice_last_units(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() <= n {
        return s.to_string();
    }
    String::from_utf16_lossy(&units[units.len() - n..])
}

fn sec_ms_gec(offset_ms: i64) -> String {
    let secs = (chrono::Utc::now().timestamp_millis() + offset_ms) / 1000 + 11_644_473_600;
    let ticks = (secs - secs % 300) as u128 * 10_000_000;
    Sha256::digest(format!("{ticks}{EDGE_TOKEN}").as_bytes())
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect()
}

fn voice_locale(voice: &str) -> String {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b)[a-z]{2,}-[A-Z]{2}(?-u:\b)").expect("static regex"));
    RE.find(voice).map_or("en-US", |m| m.as_str()).to_string()
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// One synthesis over a fresh connection.
async fn edge_synth(text: &str, voice: &str, rate: &str, pitch: &str, offset_ms: i64) -> Result<Vec<u8>, (anyhow::Error, Option<i64>)> {
    let fail = |e: anyhow::Error| (e, None);
    let id = uuid::Uuid::new_v4().simple().to_string();
    let url = format!(
        "{EDGE_WSS}?Ocp-Apim-Subscription-Key={EDGE_TOKEN}&Sec-MS-GEC={}&Sec-MS-GEC-Version=1-143.0.3650.96&ConnectionId={id}",
        sec_ms_gec(offset_ms)
    );
    let mut req = url.into_client_request().map_err(|e| fail(e.into()))?;
    req.headers_mut().insert("User-Agent", HeaderValue::from_static(EDGE_UA));
    req.headers_mut().insert("Origin", HeaderValue::from_static(EDGE_ORIGIN));
    let (mut ws, _) = match tokio_tungstenite::connect_async(req).await {
        Ok(ok) => ok,
        Err(tokio_tungstenite::tungstenite::Error::Http(res)) => {
            // a 403 usually means our clock is off: retry against the server's clock
            let server = res
                .headers()
                .get("date")
                .and_then(|d| d.to_str().ok())
                .and_then(|d| chrono::DateTime::parse_from_rfc2822(d).ok());
            let offset = (res.status().as_u16() == 403)
                .then_some(server)
                .flatten()
                .map(|d| d.timestamp_millis() - chrono::Utc::now().timestamp_millis());
            return Err((anyhow!("Unexpected server response: {}", res.status().as_u16()), offset));
        }
        Err(e) => return Err(fail(e.into())),
    };
    let config = "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
    ws.send(Message::text(config)).await.map_err(|e| fail(e.into()))?;
    let locale = voice_locale(voice);
    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let ssml = format!(
        "X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xmlns:mstts=\"https://www.w3.org/2001/mstts\" xml:lang=\"{locale}\"><voice name=\"{voice}\"><prosody pitch=\"{pitch}\" rate=\"{rate}\" volume=\"100\">{text}</prosody></voice></speak>"
    );
    ws.send(Message::text(ssml)).await.map_err(|e| fail(e.into()))?;
    let mut audio = Vec::new();
    while let Some(msg) = ws.next().await {
        match msg.map_err(|e| fail(e.into()))? {
            Message::Binary(b) => {
                let delim = b"Path:audio\r\n";
                if let Some(i) = find(&b, delim) {
                    audio.extend_from_slice(&b[i + delim.len()..]);
                }
            }
            Message::Text(t) if t.contains("Path:turn.end") => {
                let _ = ws.close(None).await;
                return Ok(audio);
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    Err(fail(anyhow!("Stream closed before the synthesis completed")))
}

#[derive(Default)]
struct TtsCache {
    map: HashMap<String, Bytes>,
    order: VecDeque<String>,
    bytes: usize,
}

/// Free neural TTS with a bounded least-recently-used cache.
pub struct TtsService {
    cache: Mutex<TtsCache>,
    default_voice: String,
    offset_ms: Mutex<i64>,
    gates: tokio::sync::Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
}

impl TtsService {
    pub fn new(default_voice: String) -> Self {
        Self {
            cache: Mutex::new(TtsCache::default()),
            default_voice,
            offset_ms: Mutex::new(0),
            gates: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    fn hit(&self, key: &str) -> Option<Bytes> {
        let mut c = self.cache.lock().ok()?;
        let v = c.map.get(key).cloned()?;
        if let Some(i) = c.order.iter().position(|k| k == key) {
            if let Some(k) = c.order.remove(i) {
                c.order.push_back(k);
            }
        }
        Some(v)
    }

    fn remember(&self, key: String, buf: Bytes) {
        let Ok(mut c) = self.cache.lock() else { return };
        c.bytes += buf.len();
        c.order.push_back(key.clone());
        c.map.insert(key, buf);
        while c.bytes > TTS_MAX_BYTES {
            let Some(k) = c.order.pop_front() else { break };
            if let Some(v) = c.map.remove(&k) {
                c.bytes -= v.len();
            }
        }
    }

    pub async fn synth(&self, text_in: &str, voice_in: Option<&str>, rate: &str) -> anyhow::Result<Bytes> {
        let pitch = "+0Hz";
        let text = slice_units(&speakable(text_in), 400);
        let voice = voice_in
            .filter(|v| catalog::VOICES.contains(v) || catalog::EDGE_LANG_VOICES.iter().any(|(_, x)| x == v))
            .unwrap_or(&self.default_voice)
            .to_string();
        let key: String = Sha1::digest(format!("{voice}|{rate}|{pitch}|{text}").as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if let Some(h) = self.hit(&key) {
            return Ok(h);
        }
        // concurrent requests for one line share one synthesis
        let gate = self.gates.lock().await.entry(key.clone()).or_default().clone();
        let _held = gate.lock().await;
        if let Some(h) = self.hit(&key) {
            return Ok(h);
        }
        let result = self.synth_uncached(&text, &voice, rate, pitch).await;
        self.gates.lock().await.remove(&key);
        let buf = Bytes::from(result?);
        if buf.is_empty() {
            bail!("empty TTS audio");
        }
        self.remember(key, buf.clone());
        Ok(buf)
    }

    async fn synth_uncached(&self, text: &str, voice: &str, rate: &str, pitch: &str) -> anyhow::Result<Vec<u8>> {
        let offset = self.offset_ms.lock().map_or(0, |o| *o);
        let run = |off| tokio::time::timeout(Duration::from_secs(12), edge_synth(text, voice, rate, pitch, off));
        match run(offset).await {
            Err(_) => bail!("TTS timeout"),
            Ok(Ok(a)) => Ok(a),
            Ok(Err((_, Some(new_offset)))) => {
                if let Ok(mut o) = self.offset_ms.lock() {
                    *o = new_offset;
                }
                match run(new_offset).await {
                    Err(_) => bail!("TTS timeout"),
                    Ok(Ok(a)) => Ok(a),
                    Ok(Err((e, _))) => Err(e),
                }
            }
            Ok(Err((e, None))) => Err(e),
        }
    }
}

/* ---------------- translation ---------------- */

static TRANSLATIONS: LazyLock<Mutex<(HashMap<String, String>, f64)>> = LazyLock::new(|| Mutex::new((HashMap::new(), 0.0)));

/// Translate an English line into `lang`; None when not needed or unavailable.
pub async fn translate_line(http: &reqwest::Client, text: &str, lang: Option<&str>) -> Option<String> {
    let tl = target_code(lang)?;
    if js::trim(text).is_empty() {
        return None;
    }
    let key = format!("{tl}|{text}");
    {
        let c = TRANSLATIONS.lock().ok()?;
        if let Some(h) = c.0.get(&key) {
            return Some(h.clone());
        }
        if now_ms() < c.1 {
            return None;
        }
    }
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={tl}&dt=t&q={}",
        urlencoding::encode(text)
    );
    let attempt = async {
        let res = http.get(url).timeout(Duration::from_secs(4)).send().await?;
        if !res.status().is_success() {
            bail!("translate HTTP {}", res.status().as_u16());
        }
        let body: Value = res.json().await?;
        let out: String = body[0].as_array().into_iter().flatten().map(|s| s[0].as_str().unwrap_or("")).collect();
        let out = js::trim(&out).to_string();
        if out.is_empty() {
            bail!("empty translation");
        }
        Ok(out)
    };
    match attempt.await {
        Ok(out) => {
            if let Ok(mut c) = TRANSLATIONS.lock() {
                if c.0.len() >= 2000 {
                    c.0.clear();
                }
                c.0.insert(key, out.clone());
            }
            Some(out)
        }
        Err(e) => {
            tracing::warn!("[translate] {e:#}");
            if let Ok(mut c) = TRANSLATIONS.lock() {
                c.1 = now_ms() + 30_000.0;
            }
            None
        }
    }
}

/* ---------------- Gemini commentary ---------------- */

fn lang_name(code: &str) -> String {
    match code {
        "en-IN" => "Indian English (a little Hinglish flavour is fine)",
        "en-GB" => "British English",
        "en-US" => "American English",
        "en-AU" => "Australian English",
        "hi-IN" => "Hindi (Devanagari script)",
        "bn-IN" => "Bengali",
        "gu-IN" => "Gujarati",
        "kn-IN" => "Kannada",
        "ml-IN" => "Malayalam",
        "mr-IN" => "Marathi",
        "pa-IN" => "Punjabi (Gurmukhi script)",
        "ta-IN" => "Tamil",
        "te-IN" => "Telugu",
        other => other,
    }
    .to_string()
}

fn strip_quotes(s: &str, marks: &[char]) -> String {
    s.trim_matches(|c| marks.contains(&c)).to_string()
}

pub struct GeminiLine<'a> {
    pub key: &'a str,
    pub model: &'a str,
    pub language: &'a str,
    pub facts: &'a str,
    pub event: &'a str,
    pub fallback: &'a str,
    pub recent: &'a [String],
}

pub async fn gemini_commentary(http: &reqwest::Client, o: GeminiLine<'_>) -> anyhow::Result<String> {
    let lang = lang_name(o.language);
    let mut prompt = vec![
        "You are the lead TV commentator on a live cricket broadcast — energetic, knowledgeable, natural, never robotic.".to_string(),
        format!("Write ONE spoken line (max 32 words) in {lang} for this exact moment."),
        "Use ONLY the facts given; never invent scores, names or numbers. No hashtags, emojis, quotes, stage directions or labels.".into(),
        "Talk ONLY about this match and its two teams. Never mention, compare with or name any other match, fixture, team or score elsewhere.".into(),
        "Sound personal and warm: speak to the viewers directly, and when you ask them something, name the teams or players involved.".into(),
        "Vary your phrasing; do not repeat these recent lines:".into(),
    ];
    let from = o.recent.len().saturating_sub(5);
    prompt.extend(o.recent[from..].iter().map(|r| format!("- {r}")));
    prompt.extend([
        String::new(),
        "MATCH FACTS:".into(),
        o.facts.to_string(),
        String::new(),
        format!("MOMENT: {}", o.event),
        format!("(A plain version for reference: \"{}\")", o.fallback),
    ]);
    let prompt = prompt.join("\n");
    let model = o.model.strip_prefix("models/").unwrap_or(o.model);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        urlencoding::encode(model)
    );
    let send = |fast: bool| {
        let mut gen = json!({ "temperature": 0.9, "maxOutputTokens": 400 });
        if fast {
            gen["thinkingConfig"] = json!({ "thinkingBudget": 0 });
        }
        http.post(&url)
            .header("x-goog-api-key", o.key)
            .timeout(Duration::from_secs(6))
            .json(&json!({ "contents": [{ "role": "user", "parts": [{ "text": prompt }] }], "generationConfig": gen }))
            .send()
    };
    let res = send(true).await?;
    let mut status = res.status();
    let mut j: Value = res.json().await.unwrap_or(Value::Null);
    if status.as_u16() == 400 && j["error"]["message"].as_str().unwrap_or("").to_lowercase().contains("think") {
        let res = send(false).await?;
        status = res.status();
        j = res.json().await.unwrap_or(Value::Null);
    }
    if !status.is_success() {
        bail!("Gemini {}: {}", status.as_u16(), j["error"]["message"].as_str().unwrap_or("request failed"));
    }
    let parts: Vec<&str> = j["candidates"][0]["content"]["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| p["text"].as_str().unwrap_or(""))
        .collect();
    let text = js::collapse_ws(&parts.join(" "));
    let text = strip_quotes(&text, &['"', '\'', '“', '”', '*']);
    let text = js::trim(&text);
    if text.is_empty() {
        bail!("Gemini returned no text");
    }
    Ok(slice_units(text, 320))
}

/// Gnani Timbre v3.0 REST TTS, returning 24 kHz mono WAV.
pub async fn gnani_speech(http: reqwest::Client, key: String, text: String, voice: String, language: String, excited: bool) -> Result<Bytes, String> {
    let run = async {
        let body = json!({
            "text": format!("{}{}", if excited { "<excited> " } else { "" }, speakable(&text)),
            "voice": voice,
            "model": "timbre-v3.0",
            "language": if language.starts_with("en") { "en-IN" } else { language.as_str() },
            "speed": 1.05,
            "audio_config": { "sample_rate": 24000, "num_channels": 1, "sample_width": 2, "encoding": "linear_pcm", "container": "wav" },
        });
        let res = http
            .post("https://api.vachana.ai/api/v1/tts/inference")
            .header("X-API-Key-ID", key)
            .timeout(Duration::from_secs(15))
            .json(&body)
            .send()
            .await?;
        let status = res.status();
        if !status.is_success() {
            let t = res.text().await.unwrap_or_default();
            let mut msg = slice_units(&t, 160);
            if let Ok(j) = serde_json::from_str::<Value>(&t) {
                let d = if j["detail"].is_object() { &j["detail"] } else { &j };
                if let Some(m) = d["message"].as_str().or_else(|| j["detail"].as_str()) {
                    msg = m.to_string();
                }
            }
            bail!("Gnani TTS {}: {msg}", status.as_u16());
        }
        let buf = res.bytes().await?;
        if buf.len() < 100 {
            bail!("Gnani TTS returned no audio");
        }
        Ok(buf)
    };
    run.await.map_err(|e: anyhow::Error| e.to_string())
}

/* ---------------- speech-to-text ---------------- */

pub const CLOUD_STT: [&str; 3] = ["gnani", "google", "gemini"];

pub struct SttRequest<'a> {
    pub wav: &'a [u8],
    pub language: &'a str,
    pub key: &'a str,
    pub gemini_model: &'a str,
    pub hints: &'a [String],
}

async fn stt_call(req: reqwest::RequestBuilder) -> anyhow::Result<Value> {
    let res = req.timeout(Duration::from_secs(15)).send().await?;
    let status = res.status();
    let text = res.text().await?;
    let j: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let det = if j["detail"].is_object() { &j["detail"] } else { &Value::Null };
        let raw = js::first(&[&j["error"]["message"], &j["message"], &det["message"], &j["detail"]]);
        let msg = match raw {
            Value::Null => slice_units(&text, 160),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        let code = js::first(&[&j["error_code"], &det["error_code"], &j["error"]["status"]]);
        let code = if js::truthy(code) {
            format!(" {}", js::to_string(code))
        } else {
            String::new()
        };
        let probe = format!("{code} {msg}").to_lowercase();
        let s = status.as_u16();
        let auth = s == 401 || s == 403 || probe.contains("api key") || probe.contains("invalid_api_key") || probe.contains("permission_denied");
        if auth {
            bail!("API key rejected ({s}{code}): {msg}");
        }
        bail!("HTTP {s}{code}: {msg}");
    }
    Ok(j)
}

pub async fn transcribe_with(http: &reqwest::Client, provider: &str, r: SttRequest<'_>) -> anyhow::Result<String> {
    match provider {
        "gnani" => {
            let part = reqwest::multipart::Part::bytes(r.wav.to_vec()).file_name("phrase.wav").mime_str("audio/wav")?;
            let mut form = reqwest::multipart::Form::new()
                .part("audio_file", part)
                .text("language_code", r.language.to_string())
                .text("format", "transcribe");
            let mut words: Vec<String> = Vec::new();
            for w in r.hints.iter().flat_map(|h| h.split(js::is_js_ws)) {
                if w.len() >= 3 && w.bytes().all(|b| b.is_ascii_alphabetic()) && !words.iter().any(|x| x == w) {
                    words.push(w.to_string());
                }
            }
            words.truncate(100);
            if !words.is_empty() {
                form = form.text("bias_list", serde_json::to_string(&words)?).text("bias_score", "1.0");
            }
            let j = stt_call(http.post("https://api.vachana.ai/stt/v3").header("X-API-Key-ID", r.key).multipart(form)).await?;
            if j["success"] == Value::Bool(false) {
                bail!("{}", j["message"].as_str().unwrap_or("Gnani transcription failed"));
            }
            Ok(js::trim(&js::str_of(&j["transcript"])).to_string())
        }
        "google" => {
            let mut config = json!({ "encoding": "LINEAR16", "sampleRateHertz": 16000, "languageCode": r.language, "enableAutomaticPunctuation": true, "model": "latest_long" });
            if !r.hints.is_empty() {
                config["speechContexts"] = json!([{ "phrases": &r.hints[..r.hints.len().min(500)], "boost": 10 }]);
            }
            let url = format!("https://speech.googleapis.com/v1/speech:recognize?key={}", urlencoding::encode(r.key));
            let j = stt_call(
                http.post(url)
                    .json(&json!({ "config": config, "audio": { "content": STANDARD.encode(r.wav) } })),
            )
            .await?;
            let parts: Vec<&str> = j["results"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|x| x["alternatives"][0]["transcript"].as_str().unwrap_or(""))
                .collect();
            Ok(js::trim(&parts.join(" ")).to_string())
        }
        _ => {
            let model = r.gemini_model.strip_prefix("models/").unwrap_or(r.gemini_model);
            let names = if r.hints.is_empty() {
                String::new()
            } else {
                format!("Names and terms that may appear: {}. ", r.hints[..r.hints.len().min(60)].join(", "))
            };
            let prompt = format!("Transcribe this live cricket commentary audio verbatim in language {}. {names}Return ONLY the spoken words as plain text, no quotes, labels or notes. If there is no clear speech, return an empty string.", r.language);
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                urlencoding::encode(model)
            );
            let body = json!({
                "contents": [{ "role": "user", "parts": [{ "text": prompt }, { "inline_data": { "mime_type": "audio/wav", "data": STANDARD.encode(r.wav) } }] }],
                "generationConfig": { "temperature": 0, "maxOutputTokens": 512 },
            });
            let j = stt_call(http.post(url).header("x-goog-api-key", r.key).json(&body)).await?;
            let text: String = j["candidates"][0]["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| p["text"].as_str().unwrap_or(""))
                .collect();
            let text = strip_quotes(js::trim(&text), &['"', '\'', '“', '”']);
            Ok(js::trim(&text).to_string())
        }
    }
}
