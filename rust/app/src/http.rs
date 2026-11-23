//! The REST API and static web app, with the same routes and responses as the original.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post, put};
use axum::Router;
use cricstudio_engine::js::{self, now_ms};
use cricstudio_engine::DEMO_KEY;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::catalog::PLATFORMS;
use crate::crypto::{hash_token, mask_key, new_id, new_token, token_matches};
use crate::room::{Services, Studios};
use crate::speech::{slice_units, CLOUD_STT};
use crate::store::{DestinationPatch, DestinationRecord, StudioRecord};

const AUDIO_EXT: [&str; 7] = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".webm", ".flac"];
const MAX_UPLOAD: usize = 40 * 1024 * 1024;

static RTMP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i-u)^rtmps?://").expect("static regex"));
static RATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[+-][0-9]{1,2}%$").expect("static regex"));
static UPLOAD_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.-]+$").expect("static regex"));

#[derive(Clone)]
pub struct App {
    pub svc: Arc<Services>,
    pub studios: Arc<Studios>,
    pub started: Instant,
    tts_hits: Arc<Mutex<HashMap<IpAddr, (u32, f64)>>>,
    has_web: bool,
}

/// JSON the way `JSON.stringify` writes it.
fn send<T: Serialize>(status: StatusCode, v: &T) -> Response {
    match js::stringify(v) {
        Ok(s) => (status, [(header::CONTENT_TYPE, "application/json; charset=utf-8")], s).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn ok<T: Serialize>(v: &T) -> Response {
    send(StatusCode::OK, v)
}

fn err(status: StatusCode, msg: &str) -> Response {
    send(status, &json!({ "error": msg }))
}

fn internal(e: &anyhow::Error) -> Response {
    send(
        StatusCode::INTERNAL_SERVER_ERROR,
        &json!({ "statusCode": 500, "error": "Internal Server Error", "message": e.to_string() }),
    )
}

fn unauthorized() -> Response {
    send(
        StatusCode::UNAUTHORIZED,
        &json!({ "statusCode": 401, "error": "Unauthorized", "message": "Unauthorized" }),
    )
}

#[expect(clippy::result_large_err, reason = "the error is the finished HTTP response")]
fn host_guard(app: &App, id: &str, headers: &HeaderMap) -> Result<StudioRecord, Response> {
    let studio = app.svc.repo.get_studio(id).map_err(|e| internal(&e))?;
    let token = headers.get("x-host-token").and_then(|v| v.to_str().ok()).unwrap_or("");
    match studio {
        Some(s) if token_matches(token, &s.host_token_hash) => Ok(s),
        _ => Err(unauthorized()),
    }
}

#[expect(clippy::result_large_err, reason = "the error is the finished HTTP response")]
fn json_body(body: &Bytes) -> Result<Value, Response> {
    if body.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(body).map_err(|e| {
        send(
            StatusCode::BAD_REQUEST,
            &json!({ "statusCode": 400, "code": "FST_ERR_CTP_INVALID_JSON_BODY", "error": "Bad Request", "message": e.to_string() }),
        )
    })
}

fn to_public(app: &App, d: &DestinationRecord) -> Value {
    let key_masked = app.svc.crypto.decrypt(&d.key_enc).map_or_else(|_| "••••".to_string(), |k| mask_key(&k));
    json!({ "id": d.id, "platform": d.platform, "name": d.name, "url": d.url, "keyMasked": key_masked, "enabled": d.enabled })
}

async fn health(State(app): State<App>) -> Response {
    ok(&json!({
        "ok": true,
        "mediaMode": app.svc.cfg.media_mode,
        "pollers": app.svc.hub.stats(),
        "studios": app.studios.stats(),
        "uptime": app.started.elapsed().as_secs_f64(),
    }))
}

async fn tts(State(app): State<App>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Query(q): Query<HashMap<String, String>>) -> Response {
    let text = js::trim(q.get("text").map_or("", String::as_str)).to_string();
    if text.is_empty() {
        return err(StatusCode::BAD_REQUEST, "text required");
    }
    // ~60 lines a minute per client is plenty for a commentator
    {
        let now = now_ms();
        let mut hits = app.tts_hits.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let h = hits.entry(addr.ip()).or_insert((0, now));
        if now - h.1 > 60_000.0 {
            *h = (0, now);
        }
        h.0 += 1;
        if h.0 > 60 {
            return err(StatusCode::TOO_MANY_REQUESTS, "slow down");
        }
        if hits.len() > 5000 {
            hits.clear();
        }
    }
    let rate = q.get("rate").filter(|r| RATE.is_match(r)).map_or("+4%", String::as_str);
    match app.svc.tts.synth(&text, q.get("voice").map(String::as_str), rate).await {
        Ok(buf) => ([(header::CACHE_CONTROL, "public, max-age=86400"), (header::CONTENT_TYPE, "audio/mpeg")], buf).into_response(),
        Err(e) => err(StatusCode::SERVICE_UNAVAILABLE, &format!("TTS unavailable: {e}")),
    }
}

async fn matches(State(app): State<App>) -> Response {
    ok(&json!({ "matches": app.svc.hub.list_matches().await }))
}

async fn match_detail(State(app): State<App>, Path((league, event)): Path<(String, String)>) -> Response {
    let key = if league == "demo" {
        DEMO_KEY.to_string()
    } else {
        format!("{league}:{event}")
    };
    match app.svc.hub.fetch_detail(&key).await {
        Ok(d) => ok(&json!({ "match": &*d })),
        Err(e) => err(StatusCode::BAD_GATEWAY, &e.to_string()),
    }
}

async fn create_studio(State(app): State<App>, body: Bytes) -> Response {
    let b = match json_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let name = slice_units(js::trim(b["name"].as_str().unwrap_or("")), 80);
    let name = if name.is_empty() { "Cricket Live Show".to_string() } else { name };
    let (host, guest, program, id) = (new_token(), new_token(), new_token(), new_id());
    let enc = match app.svc.crypto.encrypt(&guest) {
        Ok(e) => e,
        Err(e) => return internal(&e),
    };
    let rec = StudioRecord {
        id: id.clone(),
        name: name.clone(),
        match_key: b["matchKey"].as_str().map(str::to_string),
        host_token_hash: hash_token(&host),
        guest_token_hash: hash_token(&guest),
        program_token_hash: hash_token(&program),
        guest_token_enc: enc,
        settings: "{}".into(),
        created_at: now_ms() as i64,
    };
    if let Err(e) = app.svc.repo.create_studio(&rec) {
        return internal(&e);
    }
    ok(&json!({ "id": id, "name": name, "hostToken": host, "guestToken": format!("{id}.{guest}"), "programToken": program }))
}

async fn get_studio(State(app): State<App>, Path(id): Path<String>) -> Response {
    match app.svc.repo.get_studio(&id) {
        Ok(Some(s)) => ok(&json!({ "id": s.id, "name": s.name, "matchKey": s.match_key })),
        Ok(None) => err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => internal(&e),
    }
}

async fn invite(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let s = match host_guard(&app, &id, &headers) {
        Ok(s) => s,
        Err(r) => return r,
    };
    match app.svc.crypto.decrypt(&s.guest_token_enc) {
        Ok(t) => ok(&json!({ "guestToken": format!("{}.{t}", s.id) })),
        Err(e) => internal(&e),
    }
}

async fn list_destinations(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    match app.svc.repo.list_destinations(&id) {
        Ok(list) => ok(&json!({ "destinations": list.iter().map(|d| to_public(&app, d)).collect::<Vec<_>>() })),
        Err(e) => internal(&e),
    }
}

async fn add_destination(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    let b = match json_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let platform = b["platform"].as_str().unwrap_or("");
    let Some((_, label, preset)) = PLATFORMS.iter().find(|(p, _, _)| *p == platform) else {
        return err(StatusCode::BAD_REQUEST, "Unknown platform");
    };
    let url = js::trim(b["url"].as_str().filter(|u| !u.is_empty()).unwrap_or(preset)).to_string();
    if !RTMP.is_match(&url) {
        return err(StatusCode::BAD_REQUEST, "URL must start with rtmp:// or rtmps://");
    }
    let key = js::trim(b["key"].as_str().unwrap_or("")).to_string();
    if key.is_empty() && platform != "custom" {
        return err(StatusCode::BAD_REQUEST, "Stream key is required");
    }
    let key_enc = match app.svc.crypto.encrypt(&key) {
        Ok(k) => k,
        Err(e) => return internal(&e),
    };
    let d = DestinationRecord {
        id: new_id(),
        studio_id: id,
        platform: platform.to_string(),
        name: slice_units(b["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(label), 60),
        url,
        key_enc,
        enabled: b["enabled"] != Value::Bool(false),
        created_at: now_ms() as i64,
    };
    if let Err(e) = app.svc.repo.add_destination(&d) {
        return internal(&e);
    }
    ok(&json!({ "destination": to_public(&app, &d) }))
}

async fn update_destination(State(app): State<App>, Path((id, did)): Path<(String, String)>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    let b = match json_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Some(u) = b["url"].as_str().filter(|u| !u.is_empty()) {
        if !RTMP.is_match(u) {
            return err(StatusCode::BAD_REQUEST, "URL must start with rtmp:// or rtmps://");
        }
    }
    let key_enc = match b["key"].as_str().filter(|k| !k.is_empty()) {
        Some(k) => match app.svc.crypto.encrypt(js::trim(k)) {
            Ok(e) => Some(e),
            Err(e) => return internal(&e),
        },
        None => None,
    };
    let p = DestinationPatch {
        name: b["name"].as_str().map(|n| slice_units(n, 60)),
        url: b["url"].as_str().map(|u| js::trim(u).to_string()),
        key_enc,
        enabled: b.get("enabled").map(js::truthy),
    };
    match app.svc.repo.update_destination(&did, &id, p) {
        Ok(()) => ok(&json!({ "ok": true })),
        Err(e) => internal(&e),
    }
}

async fn delete_destination(State(app): State<App>, Path((id, did)): Path<(String, String)>, headers: HeaderMap) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    match app.svc.repo.delete_destination(&did, &id) {
        Ok(()) => ok(&json!({ "ok": true })),
        Err(e) => internal(&e),
    }
}

async fn put_stt(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    let b = match json_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match app.studios.load(&id) {
        Ok(Some(room)) => ok(&json!({ "stt": room.set_stt(&b) })),
        Ok(None) => err(StatusCode::NOT_FOUND, "Studio not found"),
        Err(e) => internal(&e),
    }
}

async fn test_stt(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    let b = match json_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let room = match app.studios.load(&id) {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Studio not found"),
        Err(e) => return internal(&e),
    };
    let Some(provider) = b["provider"].as_str().filter(|p| CLOUD_STT.contains(p)) else {
        return err(StatusCode::BAD_REQUEST, "Unknown provider");
    };
    ok(&room.test_stt(provider, b["key"].as_str()).await)
}

fn extname(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    match base.rfind('.') {
        Some(i) if i > 0 => base[i..].to_lowercase(),
        _ => String::new(),
    }
}

async fn upload_music(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap, mut form: Multipart) -> Response {
    if let Err(r) = host_guard(&app, &id, &headers) {
        return r;
    }
    let mut field = loop {
        match form.next_field().await {
            Ok(Some(f)) if f.file_name().is_some() => break f,
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => return err(StatusCode::BAD_REQUEST, "No file"),
        }
    };
    let filename = field.file_name().unwrap_or("").to_string();
    let ext = extname(&filename);
    if !AUDIO_EXT.contains(&ext.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Audio files only (mp3, wav, ogg, m4a, aac, flac)");
    }
    let name = format!("{id}-{}{ext}", new_id());
    let path = app.svc.cfg.data_dir.join("uploads").join(&name);
    let Ok(mut out) = tokio::fs::File::create(&path).await else {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Could not save the file");
    };
    let mut written = 0usize;
    loop {
        match field.chunk().await {
            Ok(Some(c)) => {
                written += c.len();
                if written > MAX_UPLOAD || out.write_all(&c).await.is_err() {
                    drop(out);
                    let _ = tokio::fs::remove_file(&path).await;
                    return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 40 MB)");
                }
            }
            Ok(None) => break,
            Err(_) => {
                drop(out);
                let _ = tokio::fs::remove_file(&path).await;
                return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 40 MB)");
            }
        }
    }
    let _ = out.flush().await;
    let title = filename.rfind('.').map_or(filename.as_str(), |i| &filename[..i]);
    ok(&json!({ "url": format!("/uploads/{name}"), "title": title }))
}

async fn serve_upload(State(app): State<App>, Path(file): Path<String>, req: Request) -> Response {
    if !UPLOAD_NAME.is_match(&file) || file.contains("..") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let p: PathBuf = app.svc.cfg.data_dir.join("uploads").join(&file);
    if !p.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match ServeFile::new(p).oneshot(req).await {
        Ok(r) => r.map(Body::new),
        Err(never) => match never {},
    }
}

/// Static web app with an SPA fallback for client-side routes.
async fn fallback(State(app): State<App>, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let spa = app.has_web && req.method() == Method::GET && !path.starts_with("/api") && !path.starts_with("/socket.io");
    if !spa {
        return err(StatusCode::NOT_FOUND, "Not found");
    }
    let dist = app.svc.cfg.web_dist.clone();
    let (parts, body) = req.into_parts();
    let retry = Request::from_parts(parts.clone(), Body::empty());
    let served = match ServeDir::new(&dist)
        .append_index_html_on_directories(true)
        .oneshot(Request::from_parts(parts, body))
        .await
    {
        Ok(r) => r.map(Body::new),
        Err(never) => match never {},
    };
    if served.status() != StatusCode::NOT_FOUND {
        return served;
    }
    match ServeFile::new(dist.join("index.html")).oneshot(retry).await {
        Ok(r) => r.map(Body::new),
        Err(never) => match never {},
    }
}

pub fn router(svc: Arc<Services>, studios: Arc<Studios>) -> Router {
    let has_web = svc.cfg.web_dist.exists();
    let app = App {
        svc,
        studios,
        started: Instant::now(),
        tts_hits: Arc::new(Mutex::new(HashMap::new())),
        has_web,
    };
    let music = post(upload_music).layer(DefaultBodyLimit::max(MAX_UPLOAD + 1024 * 1024));
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request());
    Router::new()
        .route("/api/health", get(health))
        .route("/api/tts", get(tts))
        .route("/api/matches", get(matches))
        .route("/api/matches/{league}/{event}", get(match_detail))
        .route("/api/studios", post(create_studio))
        .route("/api/studios/{id}", get(get_studio))
        .route("/api/studios/{id}/invite", get(invite))
        .route("/api/studios/{id}/destinations", get(list_destinations).post(add_destination))
        .route("/api/studios/{id}/destinations/{did}", patch(update_destination).delete(delete_destination))
        .route("/api/studios/{id}/stt", put(put_stt))
        .route("/api/studios/{id}/stt/test", post(test_stt))
        .route("/api/studios/{id}/music", music)
        .route("/uploads/{file}", get(serve_upload))
        .fallback(fallback)
        .layer(DefaultBodyLimit::max(1_000_000))
        .layer(cors)
        .layer(axum::middleware::map_response(|mut r: Response| async move {
            r.headers_mut()
                .entry(header::X_CONTENT_TYPE_OPTIONS)
                .or_insert(HeaderValue::from_static("nosniff"));
            r
        }))
        .with_state(app)
}
