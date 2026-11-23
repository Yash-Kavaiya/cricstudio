//! One poller per match, however many studios watch it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use cricstudio_engine::js::now_ms;
use cricstudio_engine::{build_match_detail, normalize_scorepanel, CricketEvent, DemoReplay, EventDetector, MatchDetail, MatchListItem, DEMO_KEY};
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

use crate::config::Config;
use crate::espn::{strip_detail_logos, strip_list_logos, BallStore, EspnClient};

#[derive(Clone)]
pub struct MatchUpdate {
    pub detail: Arc<MatchDetail>,
    pub events: Vec<CricketEvent>,
}

struct PollerState {
    latest: Option<Arc<MatchDetail>>,
    listeners: HashMap<u64, UnboundedSender<MatchUpdate>>,
    errors: u32,
    detector: EventDetector,
    demo: Option<DemoReplay>,
}

struct Poller {
    key: String,
    state: Mutex<PollerState>,
    store: tokio::sync::Mutex<Option<BallStore>>,
    task: Mutex<Option<tokio::task::AbortHandle>>,
}

impl Poller {
    fn lock(&self) -> MutexGuard<'_, PollerState> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn publish(&self, detail: MatchDetail, events: Vec<CricketEvent>) {
        let detail = Arc::new(detail);
        let mut st = self.lock();
        st.latest = Some(detail.clone());
        let update = MatchUpdate { detail, events };
        st.listeners.retain(|_, tx| tx.send(update.clone()).is_ok());
    }

    fn publish_demo(&self) {
        let now = now_ms();
        let (detail, events) = {
            let mut guard = self.lock();
            let st = &mut *guard;
            let Some(demo) = st.demo.as_mut() else { return };
            let detail = demo.detail(now);
            let events = st.detector.process(demo.balls(), "in", now);
            (detail, events)
        };
        self.publish(detail, events);
    }
}

pub fn parse_match_key(key: &str) -> (String, String) {
    let mut parts = key.split(':');
    (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string())
}

/// Removes the listener when dropped, and stops the poller with its last listener.
pub struct Subscription {
    hub: Weak<MatchHub>,
    key: String,
    id: u64,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(hub) = self.hub.upgrade() {
            hub.unsubscribe(&self.key, self.id);
        }
    }
}

pub struct MatchHub {
    cfg: Arc<Config>,
    client: EspnClient,
    http: reqwest::Client,
    pollers: Mutex<HashMap<String, Arc<Poller>>>,
    scorepanel: Mutex<Option<(f64, Vec<MatchListItem>)>>,
    refreshing: AtomicBool,
    refresh_gate: tokio::sync::Mutex<()>,
    demo_preview: Mutex<DemoReplay>,
    next_id: AtomicU64,
    me: Weak<MatchHub>,
}

impl MatchHub {
    pub fn new(cfg: Arc<Config>) -> anyhow::Result<Arc<Self>> {
        let client = EspnClient::new()?;
        let http = reqwest::Client::builder().user_agent("CricStudio/1.0").build()?;
        Ok(Arc::new_cyclic(|me| Self {
            cfg,
            client,
            http,
            pollers: Mutex::new(HashMap::new()),
            scorepanel: Mutex::new(None),
            refreshing: AtomicBool::new(false),
            refresh_gate: tokio::sync::Mutex::new(()),
            demo_preview: Mutex::new(DemoReplay::new(70)),
            next_id: AtomicU64::new(1),
            me: me.clone(),
        }))
    }

    fn pollers(&self) -> MutexGuard<'_, HashMap<String, Arc<Poller>>> {
        self.pollers.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn demo_item(&self) -> MatchListItem {
        let now = now_ms();
        if let Some(p) = self.pollers().get(DEMO_KEY).cloned() {
            if let Some(demo) = p.lock().demo.as_mut() {
                return demo.list_item(now);
            }
        }
        self.demo_preview.lock().unwrap_or_else(std::sync::PoisonError::into_inner).list_item(now)
    }

    async fn refresh_scorepanel(&self) -> Vec<MatchListItem> {
        let _gate = self.refresh_gate.lock().await;
        let ttl = self.cfg.scorepanel_ttl_ms as f64;
        if let Some((at, data)) = self.scorepanel.lock().ok().and_then(|c| c.clone()) {
            if now_ms() - at < ttl {
                return data;
            }
        }
        match self.client.scorepanel().await {
            Ok(raw) => {
                let mut data = normalize_scorepanel(&raw);
                strip_list_logos(&self.http, &mut data).await;
                if let Ok(mut c) = self.scorepanel.lock() {
                    *c = Some((now_ms(), data.clone()));
                }
                data
            }
            Err(e) => {
                tracing::warn!("[espn] scorepanel failed: {e}");
                self.cached_matches()
            }
        }
    }

    pub async fn list_matches(&self) -> Vec<MatchListItem> {
        let demo = self.demo_item();
        let cached = self.scorepanel.lock().ok().and_then(|c| c.clone());
        let with_demo = |data: Vec<MatchListItem>| {
            let mut out = Vec::with_capacity(data.len() + 1);
            out.push(demo.clone());
            out.extend(data);
            out
        };
        match cached {
            Some((at, data)) if now_ms() - at < self.cfg.scorepanel_ttl_ms as f64 => with_demo(data),
            Some((_, stale)) => {
                // stale-while-revalidate: answer now, refresh in the background
                if !self.refreshing.swap(true, Ordering::SeqCst) {
                    if let Some(hub) = self.me.upgrade() {
                        tokio::spawn(async move {
                            hub.refresh_scorepanel().await;
                            hub.refreshing.store(false, Ordering::SeqCst);
                        });
                    }
                }
                with_demo(stale)
            }
            None => with_demo(self.refresh_scorepanel().await),
        }
    }

    pub fn cached_matches(&self) -> Vec<MatchListItem> {
        self.scorepanel.lock().ok().and_then(|c| c.as_ref().map(|x| x.1.clone())).unwrap_or_default()
    }

    pub fn latest(&self, key: &str) -> Option<Arc<MatchDetail>> {
        let p = self.pollers().get(key).cloned()?;
        let latest = p.lock().latest.clone();
        latest
    }

    /// One-off detail fetch for the REST preview.
    pub async fn fetch_detail(&self, key: &str) -> anyhow::Result<Arc<MatchDetail>> {
        if let Some(live) = self.latest(key) {
            return Ok(live);
        }
        if key == DEMO_KEY {
            let d = self.demo_preview.lock().unwrap_or_else(std::sync::PoisonError::into_inner).detail(now_ms());
            return Ok(Arc::new(d));
        }
        let (league, event) = parse_match_key(key);
        let mut store = BallStore::new(self.client.clone(), &league, &event, 6);
        let (summary, balls) = tokio::join!(self.client.summary(&league, &event), store.sync());
        let mut d = build_match_detail(&league, &event, &summary?, &balls.unwrap_or_default(), now_ms());
        strip_detail_logos(&self.http, &mut d).await;
        Ok(Arc::new(d))
    }

    pub fn subscribe(&self, key: &str, tx: UnboundedSender<MatchUpdate>) -> Subscription {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (poller, created) = {
            let mut map = self.pollers();
            match map.get(key) {
                Some(p) => (p.clone(), false),
                None => {
                    let is_demo = key == DEMO_KEY;
                    let store = (!is_demo).then(|| {
                        let (l, e) = parse_match_key(key);
                        BallStore::new(self.client.clone(), &l, &e, 14)
                    });
                    let p = Arc::new(Poller {
                        key: key.to_string(),
                        state: Mutex::new(PollerState {
                            latest: None,
                            listeners: HashMap::new(),
                            errors: 0,
                            detector: EventDetector::new(key),
                            demo: is_demo.then(|| DemoReplay::new(70)),
                        }),
                        store: tokio::sync::Mutex::new(store),
                        task: Mutex::new(None),
                    });
                    map.insert(key.to_string(), p.clone());
                    (p, true)
                }
            }
        };
        {
            let mut st = poller.lock();
            if let Some(d) = st.latest.clone() {
                let _ = tx.send(MatchUpdate { detail: d, events: Vec::new() });
            }
            st.listeners.insert(id, tx);
        }
        if created {
            if let Some(hub) = self.me.upgrade() {
                let p = poller.clone();
                let handle = tokio::spawn(async move { hub.run(p).await });
                if let Ok(mut t) = poller.task.lock() {
                    *t = Some(handle.abort_handle());
                }
            }
        }
        Subscription {
            hub: self.me.clone(),
            key: key.to_string(),
            id,
        }
    }

    fn unsubscribe(&self, key: &str, id: u64) {
        let mut map = self.pollers();
        let Some(p) = map.get(key).cloned() else { return };
        let empty = {
            let mut st = p.lock();
            st.listeners.remove(&id);
            st.listeners.is_empty()
        };
        if empty {
            map.remove(key);
            if let Some(t) = p.task.lock().ok().and_then(|mut t| t.take()) {
                t.abort();
            }
        }
    }

    /// Demo controls: jump the replay (rehearsals).
    pub fn demo_step(&self, n: u32) {
        let Some(p) = self.pollers().get(DEMO_KEY).cloned() else { return };
        {
            let mut st = p.lock();
            let Some(demo) = st.demo.as_mut() else { return };
            for _ in 0..n {
                demo.step();
            }
        }
        p.publish_demo();
    }

    async fn run(self: Arc<Self>, p: Arc<Poller>) {
        loop {
            let next = self.tick(&p).await;
            tokio::time::sleep(Duration::from_millis(next)).await;
        }
    }

    async fn poll_live(&self, p: &Poller) -> anyhow::Result<u64> {
        let (league, event) = parse_match_key(&p.key);
        let mut guard = p.store.lock().await;
        let store = guard.as_mut().ok_or_else(|| anyhow::anyhow!("no store"))?;
        let (summary, balls) = tokio::join!(self.client.summary(&league, &event), store.sync());
        let (summary, balls) = (summary?, balls?);
        let now = now_ms();
        let mut detail = build_match_detail(&league, &event, &summary, &balls, now);
        strip_detail_logos(&self.http, &mut detail).await;
        let events = p.lock().detector.process(&balls, &detail.state, now);
        let next = if detail.state == "in" { self.cfg.poll_live_ms } else { self.cfg.poll_idle_ms };
        p.publish(detail, events);
        Ok(next)
    }

    async fn tick(&self, p: &Arc<Poller>) -> u64 {
        let is_demo = p.lock().demo.is_some();
        let result = if is_demo {
            {
                let mut guard = p.lock();
                let st = &mut *guard;
                if st.latest.is_some() {
                    let advanced = st.demo.as_mut().is_some_and(DemoReplay::step);
                    if !advanced {
                        st.detector = EventDetector::new(p.key.clone()); // loop restart
                    }
                }
            }
            p.publish_demo();
            Ok(self.cfg.demo_ball_ms)
        } else {
            self.poll_live(p).await
        };
        match result {
            Ok(next) => {
                p.lock().errors = 0;
                next
            }
            Err(e) => {
                let errors = {
                    let mut st = p.lock();
                    st.errors += 1;
                    st.errors
                };
                tracing::warn!("[espn] poll {} failed ({errors}): {e}", p.key);
                60_000u64.min(5000 * 2u64.pow(errors.min(4)))
            }
        }
    }

    pub fn stats(&self) -> Value {
        let list: Vec<Value> = self
            .pollers()
            .values()
            .map(|p| {
                let st = p.lock();
                let mut o = json!({ "key": p.key, "refs": st.listeners.len(), "errors": st.errors });
                if let Some(d) = &st.latest {
                    o["state"] = json!(d.state);
                }
                o
            })
            .collect();
        Value::Array(list)
    }
}
