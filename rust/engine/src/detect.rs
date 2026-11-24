//! Turns the ball stream into broadcast events (port of `cricket-engine/src/detect.ts`).

use std::collections::HashMap;

use crate::js::num_str as n;
use crate::types::{Ball, CricketEvent};

const BAT_MILESTONES: [f64; 6] = [50.0, 100.0, 150.0, 200.0, 250.0, 300.0];
const PARTNERSHIP_MILESTONES: [f64; 5] = [50.0, 100.0, 150.0, 200.0, 250.0];

/// Stateful per match: the first `process` primes on history so only new deliveries emit.
#[derive(Clone, Debug)]
pub struct EventDetector {
    match_key: String,
    last_seq: f64,
    last_innings: f64,
    last_state: Option<String>,
    partnership_base: HashMap<i64, f64>,
    bowler_streak: HashMap<String, u32>,
    pub primed: bool,
}

impl EventDetector {
    pub fn new(match_key: impl Into<String>) -> Self {
        Self {
            match_key: match_key.into(),
            last_seq: -1.0,
            last_innings: 0.0,
            last_state: None,
            partnership_base: HashMap::new(),
            bowler_streak: HashMap::new(),
            primed: false,
        }
    }

    pub fn last_sequence(&self) -> f64 {
        self.last_seq
    }

    pub fn prime(&mut self, balls: &[Ball], state: &str) {
        let mut sorted: Vec<&Ball> = balls.iter().collect();
        sorted.sort_by(|a, b| a.seq.partial_cmp(&b.seq).unwrap_or(std::cmp::Ordering::Equal));
        for b in &sorted {
            self.track(b);
        }
        self.last_seq = sorted.last().map_or(-1.0, |b| b.seq);
        self.last_innings = sorted.last().map_or(0.0, |b| b.innings);
        self.last_state = Some(state.to_string());
        self.primed = true;
    }

    fn base(&self, innings: f64) -> f64 {
        self.partnership_base.get(&(innings as i64)).copied().unwrap_or(0.0)
    }

    fn track(&mut self, b: &Ball) {
        if b.is_wicket {
            self.partnership_base.insert(b.innings as i64, b.innings_runs);
        }
        if let Some(bowler) = b.bowler.as_ref().filter(|_| b.is_legal()) {
            let run_out = b.dismissal_type.as_deref().unwrap_or("").to_ascii_lowercase().contains("run out");
            let streak = self.bowler_streak.entry(bowler.id.clone()).or_insert(0);
            *streak = if b.is_wicket && !run_out { *streak + 1 } else { 0 };
        }
    }

    pub fn process(&mut self, balls: &[Ball], state: &str, now: f64) -> Vec<CricketEvent> {
        if !self.primed {
            self.prime(balls, state);
            return Vec::new();
        }
        let mut events: Vec<CricketEvent> = Vec::new();
        let mut fresh: Vec<&Ball> = balls.iter().filter(|b| b.seq > self.last_seq).collect();
        fresh.sort_by(|a, b| a.seq.partial_cmp(&b.seq).unwrap_or(std::cmp::Ordering::Equal));
        let key = self.match_key.clone();
        let make = |kind: &str, ball: Option<&Ball>, title: String, subtitle: Option<String>, player: Option<String>, value: Option<f64>| CricketEvent {
            kind: kind.to_string(),
            match_key: key.clone(),
            ball: ball.cloned(),
            value,
            player,
            title,
            subtitle,
            ts: now,
        };

        for b in fresh {
            if self.last_innings != 0.0 && b.innings > self.last_innings {
                events.push(make(
                    "INNINGS_END",
                    None,
                    "Innings Break".into(),
                    Some(format!("Innings {} complete", n(self.last_innings))),
                    None,
                    Some(self.last_innings),
                ));
            }
            self.last_innings = b.innings;
            let prev_partnership = b.innings_runs - b.runs - self.base(b.innings);
            let bat_name = b.batsman.as_ref().map(|x| x.name.clone());

            events.push(make("BALL", Some(b), b.short.clone(), Some(b.text.clone()), None, None));
            match b.kind.as_str() {
                "four" => events.push(make("FOUR", Some(b), "FOUR!".into(), Some(b.short.clone()), bat_name.clone(), None)),
                "six" => events.push(make("SIX", Some(b), "SIX!".into(), Some(b.short.clone()), bat_name.clone(), None)),
                "out" => {
                    let sub = b.dismissal_text.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| b.short.clone());
                    events.push(make("WICKET", Some(b), "WICKET!".into(), Some(sub), bat_name.clone(), Some(b.innings_wickets)));
                }
                "wide" => events.push(make("WIDE", Some(b), "Wide".into(), Some(b.short.clone()), None, None)),
                "noball" => events.push(make("NOBALL", Some(b), "No Ball — Free Hit!".into(), Some(b.short.clone()), None, None)),
                _ => {}
            }

            if let Some(bat) = b.batsman.as_ref().filter(|_| b.bat_runs > 0.0) {
                let before = bat.runs - b.bat_runs;
                for m in BAT_MILESTONES {
                    if before < m && bat.runs >= m {
                        let label = if m >= 100.0 { "CENTURY" } else { "FIFTY" };
                        events.push(make(
                            "MILESTONE_BAT",
                            Some(b),
                            format!("{label}! {}", bat.name),
                            Some(format!("{} off {} balls · {}x4 · {}x6", n(bat.runs), n(bat.balls), n(bat.fours), n(bat.sixes))),
                            Some(bat.name.clone()),
                            Some(m),
                        ));
                    }
                }
            }

            if let Some(bw) = b.bowler.as_ref().filter(|x| b.is_wicket && x.wickets == 5.0) {
                events.push(make(
                    "MILESTONE_BOWL",
                    Some(b),
                    format!("FIVE-WICKET HAUL! {}", bw.name),
                    Some(format!("{}/{} in {} overs", n(bw.wickets), n(bw.conceded), n(bw.overs))),
                    Some(bw.name.clone()),
                    Some(5.0),
                ));
            }
            self.track(b);
            if let Some(bw) = b.bowler.as_ref().filter(|_| b.is_wicket) {
                if self.bowler_streak.get(&bw.id).copied().unwrap_or(0) == 2 {
                    events.push(make(
                        "HATTRICK_WATCH",
                        Some(b),
                        "ON A HAT-TRICK!".into(),
                        Some(format!("{} — two in two", bw.name)),
                        Some(bw.name.clone()),
                        None,
                    ));
                }
            }

            if !b.is_wicket {
                let current = b.innings_runs - self.base(b.innings);
                for m in PARTNERSHIP_MILESTONES {
                    if prev_partnership < m && current >= m {
                        let names: Vec<&str> = [&b.batsman, &b.non_striker]
                            .into_iter()
                            .flatten()
                            .map(|x| x.name.as_str())
                            .filter(|x| !x.is_empty())
                            .collect();
                        events.push(make(
                            "PARTNERSHIP",
                            Some(b),
                            format!("{} PARTNERSHIP", n(m)),
                            Some(names.join(" & ")),
                            None,
                            Some(m),
                        ));
                    }
                }
            }

            if b.over_complete && b.is_legal() {
                let plural = if b.over_runs == 1.0 { "" } else { "s" };
                events.push(make(
                    "OVER_END",
                    Some(b),
                    format!("End of over {}", n(b.over_number)),
                    Some(format!(
                        "{} run{plural} · {} {}/{}",
                        n(b.over_runs),
                        b.batting_team_abbr,
                        n(b.innings_runs),
                        n(b.innings_wickets)
                    )),
                    None,
                    Some(b.over_number),
                ));
            }
            self.last_seq = b.seq;
        }

        if state == "post" && self.last_state.as_deref().is_some_and(|s| !s.is_empty() && s != "post") {
            events.push(make("MATCH_END", None, "Match Over".into(), Some(String::new()), None, None));
        }
        self.last_state = Some(state.to_string());
        events
    }
}
