//! ESPN's free cricket endpoints: client, incremental play-by-play store and logo checks.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use anyhow::anyhow;
use cricstudio_engine::js::now_ms;
use cricstudio_engine::{normalize_balls, Ball, MatchDetail, MatchListItem};
use futures_util::future::{join_all, try_join_all};
use regex::Regex;
use serde_json::Value;
use urlencoding::encode;

const SITE_WEB: &str = "https://site.web.api.espn.com/apis/site/v2/sports/cricket";
const SITE: &str = "https://site.api.espn.com/apis/site/v2/sports/cricket";

#[derive(Clone)]
pub struct EspnClient {
    http: reqwest::Client,
    base_web: String,
    base: String,
}

impl EspnClient {
    pub fn new() -> anyhow::Result<Self> {
        // ESPN_BASE_URL points both APIs at a local stub in end-to-end tests
        let over = std::env::var("ESPN_BASE_URL").ok().filter(|s| !s.is_empty());
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .user_agent("CricStudio/1.0 (+live cricket broadcast studio)")
                .build()?,
            base_web: over.clone().unwrap_or_else(|| SITE_WEB.into()),
            base: over.unwrap_or_else(|| SITE.into()),
        })
    }

    async fn get(&self, url: String) -> anyhow::Result<Value> {
        let res = self.http.get(&url).header("accept", "application/json").send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("ESPN {} for {url}", res.status().as_u16()));
        }
        Ok(res.json().await?)
    }

    pub async fn scorepanel(&self) -> anyhow::Result<Value> {
        self.get(format!("{}/scorepanel", self.base_web)).await
    }

    pub async fn summary(&self, league: &str, event: &str) -> anyhow::Result<Value> {
        self.get(format!("{}/{}/summary?event={}", self.base_web, encode(league), encode(event))).await
    }

    pub async fn play_by_play(&self, league: &str, event: &str, page: u32) -> anyhow::Result<Value> {
        self.get(format!("{}/{}/playbyplay?event={}&page={page}", self.base, encode(league), encode(event)))
            .await
    }
}

fn page_count(v: &Value, fallback: u32) -> u32 {
    let n = cricstudio_engine::js::to_number(v["commentary"].get("pageCount"));
    if n.is_finite() && n >= 1.0 {
        n as u32
    } else {
        fallback
    }
}

/// Mirrors ESPN's paginated play-by-play; a live match costs about one request per tick.
pub struct BallStore {
    client: EspnClient,
    league: String,
    event: String,
    balls: HashMap<u64, Ball>,
    page_count: u32,
    initialized: bool,
    max_pages: u32,
    max_balls: usize,
}

impl BallStore {
    pub fn new(client: EspnClient, league: &str, event: &str, max_pages: u32) -> Self {
        Self {
            client,
            league: league.into(),
            event: event.into(),
            balls: HashMap::new(),
            page_count: 0,
            initialized: false,
            max_pages,
            max_balls: 900,
        }
    }

    pub fn list(&self) -> Vec<Ball> {
        let mut v: Vec<Ball> = self.balls.values().cloned().collect();
        v.sort_by(|a, b| a.seq.partial_cmp(&b.seq).unwrap_or(std::cmp::Ordering::Equal));
        v
    }

    fn ingest(&mut self, pbp: &Value) {
        for b in normalize_balls(pbp) {
            self.balls.insert(b.seq.to_bits(), b);
        }
    }

    pub async fn sync(&mut self) -> anyhow::Result<Vec<Ball>> {
        let (league, event) = (self.league.clone(), self.event.clone());
        if self.initialized {
            let last = self.client.play_by_play(&league, &event, self.page_count).await?;
            self.ingest(&last);
            let new_count = page_count(&last, self.page_count);
            for p in (self.page_count + 1)..=new_count {
                let v = self.client.play_by_play(&league, &event, p).await?;
                self.ingest(&v);
            }
            self.page_count = new_count;
        } else {
            let first = self.client.play_by_play(&league, &event, 1).await?;
            self.page_count = page_count(&first, 1);
            let start = (self.page_count + 1).saturating_sub(self.max_pages).max(1);
            if start == 1 {
                self.ingest(&first);
            }
            let pages: Vec<u32> = (start.max(2)..=self.page_count).collect();
            for chunk in pages.chunks(4) {
                let client = &self.client;
                let got = try_join_all(chunk.iter().map(|p| client.play_by_play(&league, &event, *p))).await?;
                for v in &got {
                    self.ingest(v);
                }
            }
            self.initialized = true;
        }
        if self.balls.len() > self.max_balls {
            let keep = self.list();
            let keep = &keep[keep.len() - self.max_balls..];
            self.balls = keep.iter().map(|b| (b.seq.to_bits(), b.clone())).collect();
        }
        Ok(self.list())
    }
}

/* ---------------- logo probing ---------------- */

const TTL_OK: f64 = 24.0 * 3_600_000.0;
const TTL_BAD: f64 = 6.0 * 3_600_000.0;
static LOGOS: LazyLock<Mutex<HashMap<String, (bool, f64)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static ALLOWED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i-u)^https://a[0-9]?\.espncdn\.com/").expect("static regex"));

async fn logo_ok(http: &reqwest::Client, url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    if !ALLOWED.is_match(url) {
        return true;
    }
    let now = now_ms();
    if let Some((ok, at)) = LOGOS.lock().ok().and_then(|c| c.get(url).copied()) {
        if now - at < if ok { TTL_OK } else { TTL_BAD } {
            return ok;
        }
    }
    // a network hiccup must not hide a logo we could not check
    let ok = match http.head(url).timeout(Duration::from_millis(2500)).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => true,
    };
    if let Ok(mut c) = LOGOS.lock() {
        if c.len() >= 5000 {
            c.clear();
        }
        c.insert(url.to_string(), (ok, now_ms()));
    }
    ok
}

pub async fn strip_list_logos(http: &reqwest::Client, items: &mut [MatchListItem]) {
    let checks: Vec<(usize, usize, String)> = items
        .iter()
        .enumerate()
        .flat_map(|(i, m)| {
            m.teams
                .iter()
                .enumerate()
                .filter_map(move |(j, t)| t.logo.clone().filter(|l| !l.is_empty()).map(|l| (i, j, l)))
        })
        .collect();
    let results = join_all(checks.iter().map(|(_, _, l)| logo_ok(http, l))).await;
    for ((i, j, _), ok) in checks.iter().zip(results) {
        if !ok {
            items[*i].teams[*j].logo = None;
        }
    }
}

pub async fn strip_detail_logos(http: &reqwest::Client, d: &mut MatchDetail) {
    let logos: Vec<Option<String>> = d.teams.iter().map(|t| t.logo.clone().filter(|l| !l.is_empty())).collect();
    let results = join_all(logos.iter().map(|l| async move {
        match l {
            Some(u) => logo_ok(http, u).await,
            None => true,
        }
    }))
    .await;
    for (t, ok) in d.teams.iter_mut().zip(results) {
        if !ok {
            t.logo = None;
        }
    }
}
