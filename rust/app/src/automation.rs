//! The director: turns cricket events into overlays and scene cuts (port of `automation/rules.ts`).

use std::collections::HashMap;

use cricstudio_engine::facts::countdown_target;
use cricstudio_engine::js::{now_ms, to_number};
use cricstudio_engine::{CricketEvent, MatchDetail};
use rand::seq::SliceRandom;
use rand::Rng;
use serde_json::{json, Value};

use crate::catalog::{scene, SCENES, TRANSITIONS};
use crate::state::{ActiveOverlay, StudioState};

const PROTECTED: [&str; 4] = ["startingSoon", "screenShare", "result", "message"];
const MUSIC_ROTATION: [&str; 5] = ["stadium-anthem", "powerplay-pulse", "chill-pitch", "victory-lap", "tea-break"];
const MUSIC_TRACK_MS: f64 = 240_000.0;
const CELEBRATION_VARIANTS: u32 = 5;
const DATA_GROUPS: [&str; 4] = ["Stats", "Insights", "Analysis", "Match"];

pub fn pick_transition(st: &StudioState, avoid: Option<&str>) -> String {
    let chosen = st.brand["transition"].as_str().unwrap_or("mixed");
    if chosen != "mixed" && !st.ap_bool("enabled") {
        return chosen.to_string();
    }
    let pool: Vec<&str> = TRANSITIONS.iter().copied().filter(|t| Some(*t) != avoid).collect();
    pool.choose(&mut rand::thread_rng()).copied().unwrap_or("fadeZoom").to_string()
}

#[derive(Clone, Debug)]
struct Plan {
    overlay: &'static str,
    sfx: &'static str,
    ms: f64,
    priority: i32,
    then: Option<(&'static str, f64)>,
    base: Option<&'static str>,
}

#[derive(Clone, Debug)]
struct Queued {
    plan: Plan,
    ev: CricketEvent,
    cut: bool,
}

/// What the room must do after an automation step.
#[derive(Default)]
pub struct Outcome {
    pub dirty: bool,
    pub suggestions: Vec<Value>,
}

pub struct AutomationEngine {
    queue: Vec<Queued>,
    overlay_seq: u64,
    last_scene_change: f64,
    playlist: Vec<String>,
    score_queue: Vec<String>,
    cam_queue: Vec<String>,
    group_queues: HashMap<&'static str, Vec<String>>,
    variant_bags: HashMap<String, Vec<u32>>,
    last_variant: HashMap<String, u32>,
    data_turn: usize,
    other_picks: usize,
    score_picks: usize,
    total_picks: usize,
    music_idx: usize,
    last_music_change: f64,
}

impl Default for AutomationEngine {
    fn default() -> Self {
        Self {
            queue: Vec::new(),
            overlay_seq: 0,
            last_scene_change: now_ms(),
            playlist: Vec::new(),
            score_queue: Vec::new(),
            cam_queue: Vec::new(),
            group_queues: HashMap::new(),
            variant_bags: HashMap::new(),
            last_variant: HashMap::new(),
            data_turn: 0,
            other_picks: 0,
            score_picks: 0,
            total_picks: 0,
            music_idx: 0,
            last_music_change: 0.0,
        }
    }
}

fn plan(st: &StudioState, ev: &CricketEvent) -> Option<Plan> {
    let p = |overlay, sfx, ms, priority, then, base| Plan {
        overlay,
        sfx,
        ms,
        priority,
        then,
        base,
    };
    let on = |rule: &str, x: Plan| st.rule(rule).then_some(x);
    match ev.kind.as_str() {
        "FOUR" => on("boundary", p("four", "boundaryHorn", 5000.0, 2, None, None)),
        "SIX" => on("boundary", p("six", "sixFanfare", 5500.0, 3, None, None)),
        "WICKET" => on("wicket", p("wicket", "wicketSting", 6000.0, 5, Some(("battingCard", 11000.0)), None)),
        "MILESTONE_BAT" => on("milestones", p("milestone", "milestone", 7000.0, 4, Some(("starPerformer", 9000.0)), None)),
        "MILESTONE_BOWL" => on("milestones", p("fiveWickets", "milestone", 7000.0, 4, Some(("bowlerSpotlight", 9000.0)), None)),
        "PARTNERSHIP" => on("milestones", p("partnership", "applause", 5000.0, 2, Some(("batters", 8000.0)), None)),
        "HATTRICK_WATCH" => on("wicket", p("hattrick", "drumroll", 6000.0, 4, None, None)),
        "OVER_END" => {
            let then = if ev.value.unwrap_or(0.0) % 5.0 == 0.0 {
                ("manhattan", 10000.0)
            } else {
                ("ballByBall", 8000.0)
            };
            on("overEnd", p("overSummary", "overChime", 7000.0, 1, Some(then), None))
        }
        "INNINGS_END" => on("inningsBreak", p("inningsEnd", "applause", 6000.0, 5, None, Some("break"))),
        "MATCH_END" => on("inningsBreak", p("matchEnd", "crowdRoar", 8000.0, 6, None, Some("result"))),
        _ => None,
    }
}

fn shuffled(src: &[String]) -> Vec<String> {
    let mut v = src.to_vec();
    v.shuffle(&mut rand::thread_rng());
    v
}

/// Next scene off a shuffled queue (refilled from `src`), skipping the scene already on air.
fn take(queue: &mut Vec<String>, src: &[String], current: &str) -> String {
    queue.retain(|s| src.contains(s));
    if queue.is_empty() {
        *queue = shuffled(src);
    }
    let mut next = queue.remove(0);
    if next == current && src.iter().any(|s| s != current) {
        if queue.is_empty() {
            *queue = shuffled(src);
        }
        let alt = queue.iter().position(|s| s != current);
        queue.push(next.clone());
        if let Some(i) = alt {
            next = queue.remove(i);
        }
    }
    next
}

impl AutomationEngine {
    pub fn note_manual_scene(&mut self) {
        self.last_scene_change = now_ms();
    }

    /// Every scene change goes through here so all renderers use the same transition.
    pub fn cut(&mut self, st: &mut StudioState, to: &str, temporary_ms: Option<f64>, base: bool) {
        if st.scene != to {
            st.transition = pick_transition(st, Some(&st.transition));
        }
        st.scene = to.to_string();
        if base {
            st.base_scene = to.to_string();
            st.scene_until = None;
        } else if let Some(ms) = temporary_ms.filter(|m| *m != 0.0) {
            st.scene_until = Some(now_ms() + ms);
        }
        self.last_scene_change = now_ms();
    }

    pub fn on_events(&mut self, st: &mut StudioState, m: Option<&MatchDetail>, events: &[CricketEvent]) -> Outcome {
        let mode = if st.ap_bool("enabled") { "auto".to_string() } else { st.automation.clone() };
        if mode == "manual" {
            return Outcome::default();
        }
        let mut suggestions = Vec::new();
        for ev in events {
            let Some(p) = plan(st, ev) else { continue };
            if (st.scene == "startingSoon" || st.scene == "message") && p.priority < 5 {
                continue;
            }
            if mode == "assist" {
                let tag: u32 = rand::thread_rng().gen_range(0..1_679_616);
                let reason = match ev.subtitle.as_deref().filter(|s| !s.is_empty()) {
                    Some(sub) => format!("{} — {sub}", ev.title),
                    None => ev.title.clone(),
                };
                let mut s = json!({
                    "id": format!("{}-{}-{tag:x}", ev.kind, cricstudio_engine::js::num_str(ev.ts)),
                    "overlay": p.overlay,
                    "reason": reason,
                    "event": ev,
                });
                if let Some(sc) = p.base.or(p.then.map(|t| t.0)) {
                    s["scene"] = json!(sc);
                }
                suggestions.push(s);
                continue;
            }
            let cut = st.ap_bool("enabled");
            self.enqueue(p, ev.clone(), cut);
        }
        let dirty = self.tick(st, m);
        Outcome { dirty, suggestions }
    }

    /// Apply a suggestion the host accepted, or a simulated event.
    pub fn apply_event(&mut self, st: &mut StudioState, m: Option<&MatchDetail>, ev: &CricketEvent) -> bool {
        if let Some(p) = plan(st, ev) {
            self.enqueue(p, ev.clone(), true);
        }
        self.tick(st, m)
    }

    fn enqueue(&mut self, plan: Plan, ev: CricketEvent, cut: bool) {
        self.queue.push(Queued { plan, ev, cut });
        self.queue.sort_by_key(|q| std::cmp::Reverse(q.plan.priority));
        self.queue.truncate(3);
    }

    pub fn show_overlay(&mut self, st: &mut StudioState, id: &str, title: String, subtitle: Option<String>, sfx: Option<String>, ms: f64) {
        let now = now_ms();
        self.overlay_seq += 1;
        st.overlay = Some(ActiveOverlay {
            id: id.to_string(),
            title,
            subtitle,
            value: None,
            sfx,
            started_at: now,
            until: now + ms,
            seq: self.overlay_seq,
            priority: None,
            variant: Some(self.next_variant(id)),
        });
    }

    /// A shuffled bag of celebration looks; every look comes round before any repeats.
    fn next_variant(&mut self, id: &str) -> u32 {
        let bag = self.variant_bags.entry(id.to_string()).or_default();
        if bag.is_empty() {
            *bag = (0..CELEBRATION_VARIANTS).collect();
            bag.shuffle(&mut rand::thread_rng());
            if bag.len() > 1 && Some(&bag[0]) == self.last_variant.get(id) {
                bag.rotate_left(1);
            }
        }
        let v = bag.remove(0);
        self.last_variant.insert(id.to_string(), v);
        v
    }

    fn autopilot_playlist(st: &StudioState, m: Option<&MatchDetail>) -> Vec<String> {
        let has_match = st.match_key.is_some();
        let on_stage = st.participants.iter().any(|p| p.on_stage && p.role != "program");
        let cameras = st.ap_bool("includeCameras");
        SCENES
            .iter()
            .filter(|s| {
                if !s.autopilot {
                    return false;
                }
                if s.uses_cameras {
                    return cameras && on_stage;
                }
                has_match || matches!(s.id, "aroundGrounds" | "upcomingMatches" | "fanPoll")
            })
            .map(|s| s.id)
            .filter(|id| {
                let Some(m) = m else { return true };
                let some_overs = |n: usize| m.innings.iter().any(|i| i.over_summaries.len() >= n);
                match *id {
                    "winPredictor" | "projectedScore" => m.state == "in",
                    "matchup" | "batters" | "wagonWheel" => !m.current_batters.is_empty(),
                    "ground3d" => m.innings.iter().any(|i| !i.batting.is_empty()),
                    "bowlerSpotlight" => m.current_bowler.is_some(),
                    "chaseCalculator" => m.state == "in" && (m.need.is_some() || m.innings.iter().any(|i| i.is_current && i.target > i.runs)),
                    "inningsComparison" => m.innings.iter().filter(|i| !i.over_summaries.is_empty()).count() >= 2,
                    "momentum" | "overHeatmap" | "runRateGraph" => some_overs(3),
                    "matchReport" => m.state == "post" || m.innings.len() >= 2,
                    _ => true,
                }
            })
            .map(str::to_string)
            .collect()
    }

    /// Weighted rotation: the score share stays exact over time by deficit counting.
    fn next_autopilot_scene(&mut self, st: &StudioState, m: Option<&MatchDetail>) -> Option<String> {
        let pool = Self::autopilot_playlist(st, m);
        if pool.is_empty() {
            return None;
        }
        let group = |id: &str| scene(id).map_or("", |s| s.group);
        let is_cam = |id: &str| scene(id).is_some_and(|s| s.uses_cameras);
        let score: Vec<String> = pool.iter().filter(|id| group(id) == "Score").cloned().collect();
        let cams: Vec<String> = pool.iter().filter(|id| is_cam(id)).cloned().collect();
        let data: Vec<String> = pool.iter().filter(|id| !is_cam(id) && group(id) != "Score").cloned().collect();
        let live = !score.is_empty() || !cams.is_empty();
        let share = st.ap_num("scoreShare", 0.7).clamp(0.0, 1.0);
        let pick_live = live && (data.is_empty() || (self.score_picks as f64) < share * (self.total_picks + 1) as f64);
        self.total_picks += 1;
        if pick_live {
            self.score_picks += 1;
            let cam_turn = !cams.is_empty()
                && (score.is_empty() || {
                    let turn = self.other_picks % 3 == 2;
                    self.other_picks += 1;
                    turn
                });
            return Some(if cam_turn {
                take(&mut self.cam_queue, &cams, &st.scene)
            } else {
                take(&mut self.score_queue, &score, &st.scene)
            });
        }
        let groups: Vec<(&'static str, Vec<String>)> = DATA_GROUPS
            .iter()
            .map(|g| (*g, data.iter().filter(|id| group(id) == *g).cloned().collect::<Vec<_>>()))
            .filter(|(_, v)| !v.is_empty())
            .collect();
        if groups.is_empty() {
            return Some(take(&mut self.playlist, &data, &st.scene));
        }
        let (key, rest) = &groups[self.data_turn % groups.len()];
        self.data_turn += 1;
        Some(take(self.group_queues.entry(key).or_default(), rest, &st.scene))
    }

    fn manage_music(&mut self, st: &mut StudioState, now: f64) -> bool {
        if !st.ap_bool("enabled") || !st.ap_bool("autoMusic") {
            return false;
        }
        let want = match st.scene.as_str() {
            "result" => Some("victory-lap"),
            "break" => Some("tea-break"),
            _ => None,
        };
        let rotation = |i: usize| MUSIC_ROTATION[i % MUSIC_ROTATION.len()];
        let playing = cricstudio_engine::js::truthy(&st.music["playing"]);
        let track = st.music["track"].as_str().map(str::to_string);
        if !playing {
            let v = to_number(st.music.get("volume")).min(0.4);
            st.music["playing"] = json!(true);
            st.music["track"] = json!(want.unwrap_or_else(|| rotation(self.music_idx)));
            st.music["volume"] = json!(if v == 0.0 || v.is_nan() { 0.3 } else { v });
            st.music["duck"] = json!(true);
            self.last_music_change = now;
            true
        } else if want.is_some() && track.as_deref() != want {
            st.music["track"] = json!(want);
            self.last_music_change = now;
            true
        } else if want.is_none() && now - self.last_music_change > MUSIC_TRACK_MS && !track.as_deref().is_some_and(|t| t.starts_with('/')) {
            self.music_idx += 1;
            st.music["track"] = json!(rotation(self.music_idx));
            self.last_music_change = now;
            true
        } else {
            false
        }
    }

    /// One step of the director; true when the state changed.
    pub fn tick(&mut self, st: &mut StudioState, m: Option<&MatchDetail>) -> bool {
        let now = now_ms();
        let mut dirty = false;

        let cur_priority = st.overlay.as_ref().filter(|o| o.until > now).map_or(-1, |o| o.priority.unwrap_or(0));
        if st.overlay.as_ref().is_some_and(|o| o.until <= now) {
            st.overlay = None;
            dirty = true;
        }

        if self.queue.first().is_some_and(|n| st.overlay.is_none() || n.plan.priority > cur_priority) {
            let Queued { plan, ev, cut } = self.queue.remove(0);
            self.overlay_seq += 1;
            st.overlay = Some(ActiveOverlay {
                id: plan.overlay.to_string(),
                title: ev.title.clone(),
                subtitle: ev.subtitle.clone(),
                value: ev.value,
                sfx: Some(plan.sfx.to_string()),
                started_at: now,
                until: now + plan.ms,
                seq: self.overlay_seq,
                priority: Some(plan.priority),
                variant: Some(self.next_variant(plan.overlay)),
            });
            dirty = true;
            let pinned = st.pinned_until > now && !st.ap_bool("enabled");
            if cut {
                if let Some(base) = plan.base.filter(|_| !(st.scene == "screenShare" && pinned)) {
                    self.cut(st, base, None, true);
                } else if let Some((to, ms)) = plan.then {
                    if !pinned && !PROTECTED.contains(&st.scene.as_str()) && st.scene != "break" {
                        self.cut(st, to, Some(plan.ms + ms), false);
                    }
                }
            }
        }

        if st.scene_until.is_some_and(|u| u != 0.0 && u <= now) {
            st.scene_until = None;
            if st.ap_bool("enabled") {
                self.last_scene_change = 0.0; // picks the next scene right away
            } else {
                st.base_scene = st.scene.clone();
            }
            dirty = true;
        }

        if st.ap_bool("enabled") {
            let secs = st.ap_num("sceneSeconds", 45.0);
            let hold = if st.scene == "result" || st.scene == "break" {
                (secs * 2.0).max(30.0)
            } else {
                secs
            };
            let busy = st.scene_until.is_some_and(|u| u != 0.0) || st.overlay.as_ref().is_some_and(|o| o.priority.unwrap_or(0) >= 4);
            if !busy && now - self.last_scene_change > hold * 1000.0 {
                let cd = countdown_target(st.countdown_to, m, now);
                if st.scene == "message" || (st.scene == "startingSoon" && cd.is_some_and(|c| c.0 > now)) {
                    self.last_scene_change = now;
                    return self.manage_music(st, now) || dirty;
                }
                let stay = (st.scene == "result" && m.is_some_and(|x| x.state == "post"))
                    || (st.scene == "break" && m.is_some_and(|x| x.innings.iter().any(|i| i.description == "complete") && x.innings.len() < 2));
                let next = if stay && now - self.last_scene_change < 90_000.0 {
                    None
                } else {
                    self.next_autopilot_scene(st, m)
                };
                if let Some(to) = next {
                    self.cut(st, &to, None, true);
                    dirty = true;
                } else {
                    self.last_scene_change = now;
                }
            }
            if self.manage_music(st, now) {
                dirty = true;
            }
        }
        dirty
    }

    /// Reset the rotation, for example when participants or the match changed.
    pub fn refresh_playlist(&mut self) {
        self.playlist.clear();
        self.group_queues.clear();
        self.score_queue.clear();
        self.cam_queue.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::default_state;
    use crate::store::StudioRecord;

    fn harness(mode: &str) -> (StudioState, AutomationEngine) {
        let rec = StudioRecord {
            id: "s".into(),
            name: "Show".into(),
            match_key: Some("demo:replay".into()),
            host_token_hash: String::new(),
            guest_token_hash: String::new(),
            program_token_hash: String::new(),
            guest_token_enc: String::new(),
            settings: "{}".into(),
            created_at: 0,
        };
        let mut st = default_state(&rec, "en-IN-PrabhatNeural");
        st.automation = mode.into();
        st.scene = "panel".into();
        st.base_scene = "panel".into();
        (st, AutomationEngine::default())
    }

    fn ev(kind: &str, value: Option<f64>) -> CricketEvent {
        CricketEvent {
            kind: kind.into(),
            match_key: "m".into(),
            value,
            title: kind.into(),
            ts: now_ms(),
            ..CricketEvent::default()
        }
    }

    #[test]
    fn auto_live_off_shows_overlay_without_cutting() {
        let (mut st, mut e) = harness("auto");
        e.on_events(&mut st, None, &[ev("WICKET", None)]);
        assert_eq!(st.overlay.as_ref().unwrap().id, "wicket");
        assert_eq!(st.scene, "panel");
    }

    #[test]
    fn auto_live_on_cuts_to_the_batting_card() {
        let (mut st, mut e) = harness("auto");
        st.autopilot["enabled"] = json!(true);
        e.on_events(&mut st, None, &[ev("WICKET", None)]);
        assert_eq!(st.scene, "battingCard");
        assert!(st.scene_until.is_some());
    }

    #[test]
    fn assist_suggests_and_manual_does_nothing() {
        let (mut st, mut e) = harness("assist");
        let o = e.on_events(&mut st, None, &[ev("SIX", None)]);
        assert_eq!(o.suggestions.len(), 1);
        assert!(st.overlay.is_none());
        let (mut st, mut e) = harness("manual");
        let o = e.on_events(&mut st, None, &[ev("SIX", None)]);
        assert!(o.suggestions.is_empty() && st.overlay.is_none());
    }

    #[test]
    fn higher_priority_preempts() {
        let (mut st, mut e) = harness("auto");
        e.on_events(&mut st, None, &[ev("FOUR", None)]);
        e.on_events(&mut st, None, &[ev("WICKET", None)]);
        assert_eq!(st.overlay.as_ref().unwrap().id, "wicket");
    }

    #[test]
    fn variants_cover_every_look_before_repeating() {
        let mut e = AutomationEngine::default();
        let mut seen: Vec<u32> = (0..5).map(|_| e.next_variant("four")).collect();
        seen.sort_unstable();
        assert_eq!(seen, [0, 1, 2, 3, 4]);
    }

    #[test]
    fn rotation_never_repeats_the_scene_on_air() {
        let (mut st, mut e) = harness("auto");
        st.autopilot["enabled"] = json!(true);
        let mut cur = st.scene.clone();
        for _ in 0..200 {
            let next = e.next_autopilot_scene(&st, None).unwrap();
            assert_ne!(next, cur);
            st.scene.clone_from(&next);
            cur = next;
        }
    }
}
