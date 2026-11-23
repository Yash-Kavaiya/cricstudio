//! Replays a recorded real T20I ball by ball (port of `apps/server/src/espn/demo.ts`).
//! The recording is compiled in, so the server binary needs no data files for the demo.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde_json::Value;

use crate::js::{self, num_str as n};
use crate::normalize::{balls_to_overs, build_match_detail, clean_dismissal, normalize_balls, overs_to_balls};
use crate::types::*;

pub const DEMO_KEY: &str = "demo:replay";

const SUMMARY: &str = include_str!("../../../apps/server/demo/summary.json");
const PAGES: [&str; 8] = [
    include_str!("../../../apps/server/demo/pbp1.json"),
    include_str!("../../../apps/server/demo/pbp2.json"),
    include_str!("../../../apps/server/demo/pbp3.json"),
    include_str!("../../../apps/server/demo/pbp4.json"),
    include_str!("../../../apps/server/demo/pbp5.json"),
    include_str!("../../../apps/server/demo/pbp6.json"),
    include_str!("../../../apps/server/demo/pbp7.json"),
    include_str!("../../../apps/server/demo/pbp8.json"),
];

struct Recording {
    summary: Value,
    balls: Vec<Ball>,
}

fn recording() -> &'static Recording {
    static REC: OnceLock<Recording> = OnceLock::new();
    REC.get_or_init(|| {
        let summary = serde_json::from_str(SUMMARY).unwrap_or(Value::Null);
        let mut balls = Vec::new();
        for page in PAGES {
            if let Ok(v) = serde_json::from_str::<Value>(page) {
                balls.extend(normalize_balls(&v));
            }
        }
        balls.sort_by(|a, b| a.seq.partial_cmp(&b.seq).unwrap_or(std::cmp::Ordering::Equal));
        Recording { summary, balls }
    })
}

#[derive(Clone, Debug)]
pub struct DemoReplay {
    pub cursor: usize,
    cached: Option<(usize, MatchDetail)>,
}

impl DemoReplay {
    pub fn new(start_at: usize) -> Self {
        Self {
            cursor: start_at.min(recording().balls.len()),
            cached: None,
        }
    }

    pub fn total(&self) -> usize {
        recording().balls.len()
    }

    /// Advance one delivery; false when it wrapped around.
    pub fn step(&mut self) -> bool {
        self.cursor += 1;
        if self.cursor > self.total() {
            self.cursor = 1;
            return false;
        }
        true
    }

    pub fn balls(&self) -> &'static [Ball] {
        &recording().balls[..self.cursor]
    }

    pub fn list_item(&mut self, now: f64) -> MatchListItem {
        let d = self.detail(now);
        MatchListItem {
            id: "replay".into(),
            league_id: "demo".into(),
            league_name: "Demo replay · recorded T20I".into(),
            name: d.title.clone(),
            description: format!("{} (replay)", d.description),
            state: "in".into(),
            status_text: d.summary.clone(),
            start_date: js::now_iso(),
            is_demo: Some(true),
            teams: d
                .teams
                .iter()
                .map(|t| MatchListTeam {
                    id: t.id.clone(),
                    name: t.name.clone(),
                    abbr: t.abbr.clone(),
                    logo: t.logo.clone(),
                    score: t.score.clone(),
                    winner: None,
                })
                .collect(),
        }
    }

    pub fn detail(&mut self, now: f64) -> MatchDetail {
        if self.cached.as_ref().map(|c| c.0) != Some(self.cursor) {
            self.cached = Some((self.cursor, self.build(now)));
        }
        let mut d = self.cached.as_ref().map(|c| c.1.clone()).unwrap_or_default();
        d.last_updated = now;
        d
    }

    fn build(&self, now: f64) -> MatchDetail {
        let balls = self.balls();
        let base = build_match_detail("demo", "replay", &recording().summary, balls, now);
        let last = balls.last();
        let cur_inn = last.map_or(1.0, |b| b.innings);
        let first_runs = base.innings.first().map_or(0.0, |i| i.runs);
        let innings: Vec<Innings> = base
            .innings
            .iter()
            .filter(|i| i.number <= cur_inn)
            .map(|inn| {
                let ib: Vec<&Ball> = balls.iter().filter(|b| b.innings == inn.number).collect();
                let lb = ib.last();
                let legal = ib.iter().filter(|b| b.is_legal()).count() as f64;
                Innings {
                    runs: lb.map_or(0.0, |b| b.innings_runs),
                    wickets: lb.map_or(0.0, |b| b.innings_wickets),
                    overs: balls_to_overs(legal, 6.0),
                    is_current: inn.number == cur_inn,
                    target: if inn.number == 2.0 { first_runs + 1.0 } else { 0.0 },
                    batting: batting_from_balls(&ib),
                    bowling: bowling_from_balls(&ib),
                    ..inn.clone()
                }
            })
            .collect();
        let cur = innings.iter().find(|i| i.is_current);
        let teams = base
            .teams
            .iter()
            .map(|t| {
                let parts: Vec<String> = innings
                    .iter()
                    .filter(|i| i.team_id == t.id)
                    .map(|i| {
                        let ov = if i.is_current { format!(" ({} ov)", n(i.overs)) } else { String::new() };
                        format!("{}/{}{ov}", n(i.runs), n(i.wickets))
                    })
                    .collect();
                TeamInfo {
                    score: parts.join(" & "),
                    ..t.clone()
                }
            })
            .collect();
        let mut need = None;
        let mut rrr = None;
        let mut summary = format!("{} batting", cur.map_or("", |c| c.team_abbr.as_str()));
        if let Some(c) = cur.filter(|c| c.number == 2.0) {
            let remaining = 120.0 - overs_to_balls(c.overs, 6.0);
            let nd = RunsBalls {
                runs: (c.target - c.runs).max(0.0),
                balls: remaining,
            };
            rrr = Some(if remaining > 0.0 { nd.runs / remaining * 6.0 } else { 0.0 });
            summary = format!("{} need {} runs from {} balls", c.team_name, n(nd.runs), n(nd.balls));
            need = Some(nd);
        }
        let current_batters = last
            .map(|l| {
                [&l.batsman, &l.non_striker]
                    .into_iter()
                    .flatten()
                    .filter_map(|b| cur.and_then(|c| c.batting.iter().find(|x| x.id == b.id).cloned()))
                    .collect()
            })
            .unwrap_or_default();
        let current_bowler = last
            .and_then(|l| l.bowler.as_ref())
            .and_then(|bw| cur.and_then(|c| c.bowling.iter().find(|b| b.id == bw.id).cloned()));
        let batting_team_id = cur.map(|c| c.team_id.clone());
        MatchDetail {
            key: DEMO_KEY.into(),
            is_demo: Some(true),
            state: "in".into(),
            status_text: "Live (replay)".into(),
            summary,
            teams,
            current_innings: cur_inn,
            batting_team_id,
            current_batters,
            current_bowler,
            crr: last.map_or(0.0, |b| b.run_rate),
            need,
            rrr,
            last_updated: now,
            innings,
            ..base
        }
    }
}

fn batting_from_balls(ib: &[&Ball]) -> Vec<BatterLine> {
    let mut lines: Vec<BatterLine> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut pos = 0.0;
    for b in ib {
        for bb in [&b.batsman, &b.non_striker].into_iter().flatten() {
            let existing = index.get(&bb.id).map(|i| lines[*i].clone());
            let position = existing.as_ref().map_or_else(
                || {
                    pos += 1.0;
                    pos
                },
                |e| e.position,
            );
            let line = BatterLine {
                id: bb.id.clone(),
                name: bb.name.clone(),
                position,
                runs: bb.runs,
                balls: bb.balls,
                fours: bb.fours,
                sixes: bb.sixes,
                sr: if bb.balls != 0.0 {
                    js::round(bb.runs / bb.balls * 10000.0) / 100.0
                } else {
                    0.0
                },
                dismissal: existing.as_ref().map_or_else(|| "not out".to_string(), |e| e.dismissal.clone()),
                not_out: existing.as_ref().is_none_or(|e| e.not_out),
                batted: true,
                ..BatterLine::default()
            };
            match index.get(&bb.id) {
                Some(i) => lines[*i] = line,
                None => {
                    index.insert(bb.id.clone(), lines.len());
                    lines.push(line);
                }
            }
        }
        if let (true, Some(out)) = (b.is_wicket, &b.batsman) {
            if let Some(i) = index.get(&out.id) {
                lines[*i].not_out = false;
                lines[*i].dismissal = clean_dismissal(b.dismissal_text.as_deref().unwrap_or("out"));
            }
        }
    }
    lines.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

fn bowling_from_balls(ib: &[&Ball]) -> Vec<BowlerLine> {
    let mut lines: Vec<BowlerLine> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut extras: HashMap<String, (f64, f64, f64)> = HashMap::new();
    for b in ib {
        let Some(bw) = &b.bowler else { continue };
        let e = extras.entry(bw.id.clone()).or_insert((0.0, 0.0, 0.0));
        match b.kind.as_str() {
            "wide" => e.0 += b.runs,
            "noball" => e.1 += 1.0,
            "dot" => e.2 += 1.0,
            _ => {}
        }
        let balls = overs_to_balls(bw.overs, 6.0);
        let line = BowlerLine {
            id: bw.id.clone(),
            name: bw.name.clone(),
            headshot: None,
            overs: bw.overs,
            maidens: bw.maidens,
            conceded: bw.conceded,
            wickets: bw.wickets,
            econ: if balls != 0.0 { js::round(bw.conceded / balls * 600.0) / 100.0 } else { 0.0 },
            wides: e.0,
            noballs: e.1,
            dots: e.2,
        };
        match index.get(&bw.id) {
            Some(i) => lines[*i] = line,
            None => {
                index.insert(bw.id.clone(), lines.len());
                lines.push(line);
            }
        }
    }
    lines
}
