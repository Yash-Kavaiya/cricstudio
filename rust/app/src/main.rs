//! CricStudio server: live cricket broadcast studio backend, in Rust.

mod automation;
mod catalog;
mod commentator;
mod config;
mod crypto;
mod espn;
mod http;
mod hub;
mod pipeline;
mod producer;
mod room;
mod socket;
mod speech;
mod state;
mod store;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context};
use socketioxide::extract::SocketRef;
use socketioxide::SocketIo;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::room::{Out, Services, Studios};

/// Delivers socket messages one at a time, so clients see them in the order they were produced.
async fn outbox(io: SocketIo, mut rx: UnboundedReceiver<Out>) {
    while let Some(msg) = rx.recv().await {
        match msg {
            Out::Room(room, event, data) => {
                let _ = io.to(room).emit(event, &data).await;
            }
            Out::To(sid, event, data) => {
                if let Some(s) = sid.parse().ok().and_then(|id| io.get_socket(id)) {
                    let _ = s.emit(event, &data);
                }
            }
        }
    }
}

/// These deployment modes need services this build does not talk to: refuse rather than ignore them.
fn check_supported(cfg: &Config) -> anyhow::Result<()> {
    if !cfg.redis_url.is_empty() {
        bail!("REDIS_URL/KV_URL is set, but the Rust server runs as a single instance with SQLite. Unset it, or use the Node server for multi-instance deployments.");
    }
    if !cfg.database_url.is_empty() {
        bail!("DATABASE_URL is set, but the Rust server stores data in SQLite. Unset it, or use the Node server for Postgres.");
    }
    if cfg.media_mode == "livekit" {
        bail!("MEDIA_MODE=livekit is not supported by the Rust server. Use MEDIA_MODE=mesh, or the Node server for LiveKit.");
    }
    Ok(())
}

async fn resume_live(studios: &Studios, seen: &tokio::sync::Mutex<HashMap<String, String>>) {
    let ids = studios.svc.repo.list_live_studios().unwrap_or_default();
    for id in ids {
        let Ok(Some(room)) = studios.load(&id) else { continue };
        {
            let g = room.lock();
            if g.is_live() || !g.state.want_live || !g.state.ap_bool("cloud") {
                continue; // a human producer must come back and press Go live
            }
        }
        if studios.svc.cfg.streaming_disabled {
            continue;
        }
        let msg = match room.start_live("cloud") {
            Ok(()) => "live (cloud producer)".to_string(),
            Err(e) => e,
        };
        let mut log = seen.lock().await;
        if log.get(&id) != Some(&msg) {
            tracing::info!("[resume] studio {id} → {msg}");
        }
        log.insert(id, msg);
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {}
        () = term => {}
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = Arc::new(Config::load()?);
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_env("LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    check_supported(&cfg)?;

    let repo = Arc::new(store::Repo::open(&cfg.data_dir.join("cricstudio.db")).context("opening the database")?);
    let crypto = crypto::Crypto::new(&cfg.stream_key_secret, &cfg.data_dir)?;
    let hub = hub::MatchHub::new(cfg.clone())?;
    let http_client = reqwest::Client::builder().user_agent("CricStudio/1.0").build()?;

    let (layer, io) = SocketIo::builder()
        .max_payload(16 * 1024 * 1024)
        .max_buffer_size(4096)
        .ws_max_message_size(16 * 1024 * 1024)
        .ws_max_frame_size(16 * 1024 * 1024)
        .ping_timeout(Duration::from_secs(30))
        .build_layer();

    let (out, out_rx) = unbounded_channel();
    tokio::spawn(outbox(io.clone(), out_rx));
    let svc = Arc::new(Services {
        tts: speech::TtsService::new(cfg.tts_voice.clone()),
        cfg: cfg.clone(),
        out,
        io: io.clone(),
        hub,
        repo,
        crypto,
        http: http_client,
    });
    let studios = Studios::new(svc.clone());
    {
        let studios = studios.clone();
        io.ns("/", move |s: SocketRef| {
            let studios = studios.clone();
            async move { socket::on_connect(s, studios) }
        });
    }

    let app = http::router(svc, studios.clone()).layer(layer);
    let addr: SocketAddr = format!("{}:{}", cfg.host, cfg.port).parse().context("bad HOST/PORT")?;
    let listener = tokio::net::TcpListener::bind(addr).await.with_context(|| format!("binding {addr}"))?;
    tracing::info!("CricStudio server on :{} · media={} · bus=memory · db=sqlite", cfg.port, cfg.media_mode);

    // 24/7: resume every studio that should be live, at boot and then every 30 s
    {
        let studios = studios.clone();
        tokio::spawn(async move {
            let seen = tokio::sync::Mutex::new(HashMap::new());
            tokio::time::sleep(Duration::from_secs(3)).await;
            loop {
                resume_live(&studios, &seen).await;
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
    }

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    // keep wantLive so the next boot resumes
    studios.suspend_all();
    tokio::time::sleep(Duration::from_millis(300)).await;
    Ok(())
}
