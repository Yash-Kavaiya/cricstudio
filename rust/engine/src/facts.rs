//! Compact match context for the AI commentator (port of `matchFacts`/`eventFacts`).

use crate::js::{self, num_str as n, to_fixed};
use crate::types::{CricketEvent, MatchDetail};

/// Countdown target: the manual timer, else the selected match's scheduled start.
pub fn countdown_target(countdown_to: Option<f64>, m: Option<&MatchDetail>, now: f64) -> Option<(f64, bool)> {
    if let Some(at) = countdown_to.filter(|x| *x != 0.0) {
        return Some((at, false));
    }
    let m = m.filter(|x| x.state == "pre")?;
    let at = js::date_parse(m.start_date.as_deref().filter(|s| !s.is_empty())?);
    (at.is_finite() && at > now - 3_600_000.0).then_some((at, true))
}

/// Whole minutes until the countdown or scheduled start.
pub fn minutes_to_start(d: Option<&MatchDetail>, countdown_to: Option<f64>, now: f64) -> Option<f64> {
    let (at, _) = countdown_target(countdown_to, d, now)?;
    let ms = at - now;
    (ms > 0.0).then(|| (ms / 60_000.0).ceil())
}

pub fn match_facts(d: Option<&MatchDetail>, countdown_to: Option<f64>, now: f64) -> String {
    let Some(d) = d else { return "No live match attached.".into() };
    let mut lines: Vec<String> = Vec::new();
    let venue = if d.venue.is_empty() { String::new() } else { format!(" at {}", d.venue) };
    lines.push(format!("Match: {}, {}{venue}.", d.title, d.description));
    if !d.status_text.is_empty() {
        lines.push(format!("Status: {}.", d.status_text));
    }
    if !d.series.is_empty() {
        lines.push(format!("Series: {}.", d.series));
    }
    if d.state == "pre" {
        let mins = minutes_to_start(Some(d), countdown_to, now).map_or_else(String::new, |m| format!("; starts in about {} minutes", n(m)));
        lines.push(format!("Stage: pre-match build-up, the first ball has not been bowled{mins}."));
    }
    if !d.toss.is_empty() {
        lines.push(format!("Toss: {}.", d.toss));
    }
    for t in &d.teams {
        if let Some(c) = t.squad.iter().find(|p| p.captain).filter(|p| !p.name.is_empty()) {
            lines.push(format!("{} captain: {}.", t.name, c.name));
        }
    }
    if d.state == "pre" {
        for t in d.teams.iter().filter(|t| !t.squad.is_empty()) {
            let names: Vec<&str> = t.squad.iter().take(11).map(|p| p.name.as_str()).collect();
            lines.push(format!("{} players: {}.", t.name, names.join(", ")));
        }
    }
    if let Some(i) = d.innings.iter().find(|i| i.number == d.current_innings).or_else(|| d.innings.last()) {
        let chase = if i.target != 0.0 {
            format!(", chasing {}", n(i.target))
        } else {
            String::new()
        };
        lines.push(format!("{}: {}/{} in {} overs{chase}.", i.team_name, n(i.runs), n(i.wickets), n(i.overs)));
    }
    if let Some(need) = &d.need {
        let rate = d
            .rrr
            .filter(|r| *r != 0.0)
            .map_or_else(String::new, |r| format!(" (required rate {})", to_fixed(r, 2)));
        lines.push(format!("Need {} from {} balls{rate}.", n(need.runs), n(need.balls)));
    }
    if d.crr != 0.0 {
        lines.push(format!("Current run rate {}.", to_fixed(d.crr, 2)));
    }
    for b in &d.current_batters {
        lines.push(format!(
            "Batter {}: {} ({}b, {}x4, {}x6).",
            b.name,
            n(b.runs),
            n(b.balls),
            n(b.fours),
            n(b.sixes)
        ));
    }
    if let Some(b) = &d.current_bowler {
        lines.push(format!("Bowler {}: {}/{} in {} overs.", b.name, n(b.wickets), n(b.conceded), n(b.overs)));
    }
    if d.partnership.balls != 0.0 {
        lines.push(format!("Partnership {} off {}.", n(d.partnership.runs), n(d.partnership.balls)));
    }
    if !d.recent_balls.is_empty() {
        let from = d.recent_balls.len().saturating_sub(6);
        let last: Vec<String> = d.recent_balls[from..]
            .iter()
            .map(|b| format!("{} {}", n(b.over), if b.short.is_empty() { &b.label } else { &b.short }))
            .collect();
        lines.push(format!("Last balls (oldest first): {}.", last.join(" | ")));
    }
    let batting = d.teams.iter().any(|t| Some(&t.id) == d.batting_team_id.as_ref());
    if batting && !d.summary.is_empty() {
        lines.push(format!("Summary: {}.", d.summary));
    }
    lines.join("\n")
}

pub fn event_facts(ev: Option<&CricketEvent>, d: Option<&MatchDetail>) -> String {
    let Some(ev) = ev else {
        return if d.is_some_and(|m| m.state == "pre") {
            "Pre-match build-up — preview this match, a player to watch, or ask viewers a question that names both teams.".into()
        } else {
            "Quiet spell between deliveries — offer insight, a stat-driven observation or a question to viewers about this match.".into()
        };
    };
    let mut parts = vec![format!("Event: {} — {}", ev.kind, ev.title)];
    if let Some(s) = ev.subtitle.as_ref().filter(|s| !s.is_empty()) {
        parts.push(s.clone());
    }
    if let Some(p) = ev.player.as_ref().filter(|s| !s.is_empty()) {
        parts.push(format!("player {p}"));
    }
    if let Some(v) = ev.value {
        parts.push(format!("value {}", n(v)));
    }
    if let Some(b) = ev.ball.as_ref().filter(|b| !b.text.is_empty()) {
        parts.push(format!("delivery: {}", b.text));
    }
    parts.join(", ") + "."
}
