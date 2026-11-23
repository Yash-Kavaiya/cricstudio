//! ESPN JSON to CricStudio's match model (port of `cricket-engine/src/normalize.ts`).

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::{Captures, Regex};
use serde_json::{Map, Value};

use crate::js::{self, first, num, num_or, str_of, str_or, truthy};
use crate::types::*;

static NULL: Value = Value::Null;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("static regex"))
}

fn opt_str(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

fn cmp(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

fn arr(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], Vec::as_slice)
}

pub fn overs_to_balls(overs: f64, bpo: f64) -> f64 {
    let whole = overs.floor();
    whole * bpo + js::round((overs - whole) * 10.0)
}

pub fn balls_to_overs(balls: f64, bpo: f64) -> f64 {
    (balls / bpo).floor() + (balls % bpo) / 10.0
}

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "quot" => "\"",
        "apos" => "'",
        "lt" => "<",
        "gt" => ">",
        "nbsp" => " ",
        "dagger" => "†",
        "Dagger" => "‡",
        "ndash" => "–",
        "mdash" => "—",
        "hellip" => "…",
        "lsquo" => "‘",
        "rsquo" => "’",
        "ldquo" => "“",
        "rdquo" => "”",
        "bull" => "•",
        "middot" => "·",
        "times" => "×",
        _ => return None,
    })
}

/// Decode the HTML entities ESPN leaves in commentary and dismissal text.
pub fn decode_entities(s: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(&RE, "&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);")
        .replace_all(s, |c: &Captures| {
            let whole = &c[0];
            let e = &c[1];
            if let Some(rest) = e.strip_prefix('#') {
                let code = match rest.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => rest.parse::<u32>().ok(),
                };
                return code
                    .filter(|n| *n > 0 && *n < 0x11_0000)
                    .and_then(char::from_u32)
                    .map_or_else(|| whole.to_string(), String::from);
            }
            named_entity(e).map_or_else(|| whole.to_string(), str::to_string)
        })
        .into_owned()
}

pub fn strip_html(s: &str) -> String {
    static BR: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    let br = BR.get_or_init(|| Regex::new(&format!("<[bB][rR]{}*/?>", js::JS_WS)).expect("static regex"));
    let no_br = br.replace_all(s, " ");
    let no_tags = re(&TAG, "<[^>]+>").replace_all(&no_br, "");
    js::trim(&js::collapse_ws(&decode_entities(&no_tags))).to_string()
}

/// `"J Andrew lbw b Patel 21 (23m 16b 2x4 1x6) SR: 131.25"` to `"lbw b Patel"`.
pub fn clean_dismissal(text: &str) -> String {
    static TAIL: OnceLock<Regex> = OnceLock::new();
    static HOW: OnceLock<Regex> = OnceLock::new();
    let tail = TAIL.get_or_init(|| {
        let ws = js::JS_WS;
        Regex::new(&format!(r"{ws}+[0-9]+{ws}*\([^\n\r\u{{2028}}\u{{2029}}]*\z")).expect("static regex")
    });
    let how = HOW.get_or_init(|| {
        let ws = js::JS_WS;
        Regex::new(&format!(
            r"(?-u:\b)(c & b|c{ws}|lbw|b{ws}|st{ws}|run out|hit wicket|retired|obstructing|handled|timed out)"
        ))
        .expect("static regex")
    });
    let replaced = tail.replace(text, "");
    let mut t = js::trim(&replaced);
    if let Some(m) = how.find(t) {
        t = &t[m.start()..];
    }
    if t.is_empty() {
        text.to_string()
    } else {
        t.to_string()
    }
}

fn dismissal_code(code: &str) -> Option<&'static str> {
    Some(match code {
        "c" => "caught",
        "b" => "bowled",
        "lbw" => "lbw",
        "st" => "stumped",
        "ro" => "run out",
        "hw" => "hit wicket",
        "rtd" => "retired",
        _ => return None,
    })
}

/* ------------------------------ scorepanel ------------------------------ */

pub fn normalize_scorepanel(raw: &Value) -> Vec<MatchListItem> {
    let mut out = Vec::new();
    for group in arr(&raw["scores"]) {
        let league = &group["leagues"][0];
        for ev in arr(&group["events"]) {
            let comp = &ev["competitions"][0];
            let status = &comp["status"]["type"];
            let state = first(&[&status["state"], &ev["status"]["type"]["state"]]);
            let state = if state.is_null() { "pre".to_string() } else { str_of(state) };
            let summary = str_of(&comp["status"]["summary"]);
            let detail = str_of(first(&[&status["detail"], &status["description"]]));
            let mut competitors: Vec<&Value> = arr(&comp["competitors"]).iter().collect();
            competitors.sort_by(|a, b| cmp(num(&a["order"]), num(&b["order"])));
            let teams = competitors
                .into_iter()
                .map(|c| {
                    let t = &c["team"];
                    let logo = if truthy(&t["logo"]) { &t["logo"] } else { &t["logos"][0]["href"] };
                    MatchListTeam {
                        id: str_of(first(&[&t["id"], &c["id"]])),
                        name: str_of(first(&[&t["displayName"], &t["name"]])),
                        abbr: str_of(&t["abbreviation"]),
                        logo: if truthy(logo) { opt_str(logo) } else { None },
                        score: str_of(&c["score"]),
                        winner: Some(is_winner(c)),
                    }
                })
                .collect();
            out.push(MatchListItem {
                id: str_of(&ev["id"]),
                league_id: str_of(first(&[&league["id"], &ev["leagueId"]])),
                league_name: str_of(first(&[&league["name"], &league["abbreviation"]])),
                name: str_of(&ev["name"]),
                description: str_of(first(&[&comp["description"], &ev["description"]])),
                state,
                status_text: if summary.is_empty() { detail } else { summary },
                start_date: str_of(first(&[&ev["date"], &comp["date"]])),
                is_demo: None,
                teams,
            });
        }
    }
    let rank = |s: &str| match s {
        "in" => 0,
        "pre" => 1,
        "post" => 2,
        _ => 3,
    };
    out.sort_by_key(|m| rank(&m.state));
    out
}

fn is_winner(c: &Value) -> bool {
    c["winner"] == Value::Bool(true) || c["winner"].as_str() == Some("true")
}

/* ------------------------------ play-by-play ------------------------------ */

fn ball_type(item: &Value) -> &'static str {
    let id = str_of(&item["playType"]["id"]);
    let d = str_of(&item["playType"]["description"]).to_lowercase();
    if truthy(&item["dismissal"]["dismissal"]) || id == "9" || d == "out" {
        "out"
    } else if id == "4" || d == "six" {
        "six"
    } else if id == "3" || d == "four" {
        "four"
    } else if id == "6" || d.contains("wide") {
        "wide"
    } else if id == "5" || d.contains("no ball") {
        "noball"
    } else if id == "8" || d.contains("leg bye") {
        "legbye"
    } else if id == "7" || d == "bye" || d.contains("byes") {
        "bye"
    } else if id == "2" || d == "no run" {
        "dot"
    } else if num(&item["scoreValue"]) > 0.0 {
        "run"
    } else {
        "dot"
    }
}

pub fn ball_label(kind: &str, runs: f64, bat_runs: f64) -> String {
    let n = js::num_str;
    match kind {
        "dot" => "•".into(),
        "out" => "W".into(),
        "four" => "4".into(),
        "six" => "6".into(),
        "wide" => {
            if runs > 1.0 {
                format!("{}wd", n(runs))
            } else {
                "wd".into()
            }
        }
        "noball" => {
            if bat_runs > 0.0 {
                format!("{}nb", n(bat_runs))
            } else {
                "nb".into()
            }
        }
        "legbye" => format!("{}lb", n(runs)),
        "bye" => format!("{}b", n(runs)),
        _ => n(runs),
    }
}

fn batter(b: &Value) -> Option<BallBatter> {
    let a = &b["athlete"];
    if !truthy(a) {
        return None;
    }
    Some(BallBatter {
        id: str_of(&a["id"]),
        name: str_of(first(&[&a["displayName"], &a["name"]])),
        runs: num(&b["totalRuns"]),
        balls: num(&b["faced"]),
        fours: num(&b["fours"]),
        sixes: num(&b["sixes"]),
    })
}

pub fn normalize_ball(item: &Value) -> Ball {
    let kind = ball_type(item);
    let runs = num(&item["scoreValue"]);
    let bat_runs = num_or(&item["batsman"]["runs"], if kind == "wide" { 0.0 } else { runs });
    let inn = &item["innings"];
    let ov = &item["over"];
    let actual = num(first(&[&ov["actual"], &ov["overs"]]));
    let ball_in_over = num(&ov["ball"]);
    let dismissed = truthy(&item["dismissal"]["dismissal"]);
    let parsed = js::date_parse(&str_of(&item["date"]));
    let date_ms = if parsed.is_nan() || parsed == 0.0 { 0.0 } else { parsed };
    let bowler = &item["bowler"];
    Ball {
        id: str_of(&item["id"]),
        seq: num(&item["sequence"]),
        innings: num_or(first(&[&inn["number"], &item["period"]]), 1.0),
        over: actual,
        over_number: num_or(&ov["number"], actual.floor() + 1.0),
        ball_in_over,
        kind: kind.to_string(),
        runs,
        bat_runs,
        is_wicket: kind == "out",
        label: ball_label(kind, runs, bat_runs),
        short: str_of(&item["shortText"]),
        text: strip_html(&str_of(&item["text"])),
        batting_team_id: str_of(&item["team"]["id"]),
        batting_team_abbr: str_of(&item["team"]["abbreviation"]),
        innings_runs: num(&inn["runs"]),
        innings_wickets: num(&inn["wickets"]),
        run_rate: num(&inn["runRate"]),
        remaining_balls: num(&inn["remainingBalls"]),
        ball_limit: num(&inn["ballLimit"]),
        target: num(&inn["target"]),
        over_runs: num(&ov["runs"]),
        over_complete: ov["complete"] == Value::Bool(true) || (ball_in_over >= num_or(&ov["balls"], 6.0) && kind != "wide" && kind != "noball"),
        batsman: batter(&item["batsman"]),
        non_striker: batter(&item["otherBatsman"]),
        bowler: truthy(&bowler["athlete"]).then(|| BallBowler {
            id: str_of(&bowler["athlete"]["id"]),
            name: str_of(&bowler["athlete"]["displayName"]),
            overs: num(&bowler["overs"]),
            conceded: num(&bowler["conceded"]),
            wickets: num(&bowler["wickets"]),
            maidens: num(&bowler["maidens"]),
        }),
        dismissal_text: dismissed.then(|| strip_html(&str_of(&item["dismissal"]["text"]))),
        dismissal_type: dismissed.then(|| str_of(&item["dismissal"]["type"])),
        ts: num_or(&item["bbbTimestamp"], date_ms),
    }
}

pub fn normalize_balls(pbp: &Value) -> Vec<Ball> {
    let mut balls: Vec<Ball> = arr(&pbp["commentary"]["items"]).iter().map(normalize_ball).collect();
    balls.sort_by(|a, b| cmp(a.seq, b.seq));
    balls
}

/* ------------------------------ match detail ------------------------------ */

fn stat_map(stats: &Value) -> Map<String, Value> {
    let mut m = Map::new();
    for cat in arr(&stats["categories"]) {
        for s in arr(&cat["stats"]) {
            m.insert(js::to_string(&s["name"]), first(&[&s["value"], &s["displayValue"]]).clone());
        }
    }
    m
}

fn stat<'a>(m: &'a Map<String, Value>, k: &str) -> &'a Value {
    m.get(k).unwrap_or(&NULL)
}

fn role_name(pos: &str) -> Option<&'static str> {
    Some(match pos {
        "WK" => "Wicketkeeper",
        "WBT" => "Wicketkeeper batter",
        "BT" | "BAT" => "Batter",
        "AR" => "Allrounder",
        "BL" | "BOWL" => "Bowler",
        _ => return None,
    })
}

fn squad_from_roster(roster: &[Value]) -> Vec<SquadPlayer> {
    roster
        .iter()
        .map(|p| {
            let a = &p["athlete"];
            let pos = str_of(first(&[&p["position"]["abbreviation"], &a["position"]["abbreviation"]]));
            SquadPlayer {
                id: str_of(&a["id"]),
                name: str_of(&a["displayName"]),
                role: role_name(&pos).map_or_else(|| str_or(&a["position"]["name"], "Player").replacen("Unknown", "Player", 1), str::to_string),
                captain: truthy(&p["captain"]),
                keeper: pos == "WK" || pos == "WBT",
                headshot: opt_str(&a["headshot"]["href"]),
            }
        })
        .collect()
}

fn line_for(p: &Value, period: f64) -> Option<&Value> {
    arr(&p["linescores"]).iter().find(|l| num(&l["period"]) == period)
}

fn batting_for(roster: &[Value], period: f64, dismissals: &HashMap<String, String>) -> Vec<BatterLine> {
    let mut lines = Vec::new();
    for p in roster {
        let Some(ls) = line_for(p, period) else { continue };
        let s = stat_map(&ls["statistics"]);
        let batting = &ls["linescores"][0]["batting"];
        if num(stat(&s, "batted")) != 1.0 && !truthy(&batting["active"]) {
            continue;
        }
        let a = &p["athlete"];
        let id = str_of(&a["id"]);
        let code = strip_html(&str_or(first(&[&batting["outDetails"]["shortText"], stat(&s, "dismissalCard")]), "not out"));
        let not_out = num(stat(&s, "outs")) == 0.0;
        let dismissal = if not_out {
            code
        } else {
            dismissals
                .get(&id)
                .cloned()
                .or_else(|| dismissal_code(&code).map(str::to_string))
                .unwrap_or(code)
        };
        lines.push(BatterLine {
            id,
            name: str_of(&a["displayName"]),
            headshot: opt_str(&a["headshot"]["href"]),
            position: num_or(stat(&s, "battingPosition"), 99.0),
            runs: num(stat(&s, "runs")),
            balls: num(stat(&s, "ballsFaced")),
            fours: num(stat(&s, "fours")),
            sixes: num(stat(&s, "sixes")),
            sr: num(stat(&s, "strikeRate")),
            dismissal,
            not_out,
            batted: true,
            wagon: batting["wagonZone"].as_array().map(|z| z.iter().map(|x| num(&x["runs"])).collect()),
            dot_pct: batting.get("dotBallPercentage").map(num),
            control: batting.get("controlPercentage").map(num),
            preferred_shot: truthy(&batting["preferredShot"]["shotName"]).then(|| str_of(&batting["preferredShot"]["shotName"])),
        });
    }
    lines.sort_by(|a, b| cmp(a.position, b.position));
    lines
}

fn bowling_for(roster: &[Value], period: f64) -> Vec<BowlerLine> {
    let mut lines: Vec<(f64, BowlerLine)> = Vec::new();
    for p in roster {
        let Some(ls) = line_for(p, period) else { continue };
        let s = stat_map(&ls["statistics"]);
        if num(stat(&s, "bowled")) != 1.0 && num(stat(&s, "balls")) == 0.0 {
            continue;
        }
        let a = &p["athlete"];
        lines.push((
            num_or(stat(&s, "bowlingPosition"), 99.0),
            BowlerLine {
                id: str_of(&a["id"]),
                name: str_of(&a["displayName"]),
                headshot: opt_str(&a["headshot"]["href"]),
                overs: num(stat(&s, "overs")),
                maidens: num(stat(&s, "maidens")),
                conceded: num(stat(&s, "conceded")),
                wickets: num(stat(&s, "wickets")),
                econ: num(stat(&s, "economyRate")),
                wides: num(stat(&s, "wides")),
                noballs: num(stat(&s, "noballs")),
                dots: num(stat(&s, "dots")),
            },
        ));
    }
    lines.sort_by(|a, b| cmp(a.0, b.0));
    lines.into_iter().map(|(_, l)| l).collect()
}

/// Per-over summaries (Manhattan, worm) and fall of wickets for one innings.
pub fn build_over_summaries(balls: &[Ball], innings: f64) -> (Vec<OverSummary>, Vec<FallOfWicket>) {
    let mut ib: Vec<&Ball> = balls.iter().filter(|b| b.innings == innings).collect();
    ib.sort_by(|a, b| cmp(a.seq, b.seq));
    let mut overs: Vec<OverSummary> = Vec::new();
    let mut fow = Vec::new();
    for b in &ib {
        let idx = overs.iter().position(|o| o.over == b.over_number).unwrap_or_else(|| {
            overs.push(OverSummary {
                innings,
                over: b.over_number,
                ..OverSummary::default()
            });
            overs.len() - 1
        });
        let o = &mut overs[idx];
        o.runs += b.runs;
        o.balls.push(b.label.clone());
        o.cumulative = b.innings_runs;
        if b.is_wicket {
            o.wickets += 1.0;
            fow.push(FallOfWicket {
                wicket: b.innings_wickets,
                runs: b.innings_runs,
                over: b.over,
                batter: b.batsman.as_ref().map_or_else(String::new, |x| x.name.clone()),
            });
        }
    }
    overs.sort_by(|a, b| cmp(a.over, b.over));
    for o in &mut overs {
        if let Some(last) = ib.iter().rev().find(|b| b.over_number == o.over) {
            if last.over_runs >= o.runs {
                o.runs = last.over_runs;
            }
        }
    }
    (overs, fow)
}

fn team_id(c: &Value) -> String {
    str_of(first(&[&c["team"]["id"], &c["id"]]))
}

pub fn build_match_detail(league_id: &str, event_id: &str, summary: &Value, balls: &[Ball], now: f64) -> MatchDetail {
    let header = &summary["header"];
    let comp = &header["competitions"][0];
    let status = &comp["status"];
    let state = if status["type"]["state"].is_null() {
        "pre".to_string()
    } else {
        str_of(&status["type"]["state"])
    };

    let mut roster_by_team: HashMap<String, &[Value]> = HashMap::new();
    for r in arr(&summary["rosters"]) {
        roster_by_team.insert(str_of(&r["team"]["id"]), arr(&r["roster"]));
    }
    let roster = |id: &str| roster_by_team.get(id).copied().unwrap_or(&[]);

    let competitors = arr(&comp["competitors"]);
    let mut ordered: Vec<&Value> = competitors.iter().collect();
    ordered.sort_by(|a, b| cmp(num(&a["order"]), num(&b["order"])));
    let teams: Vec<TeamInfo> = ordered
        .iter()
        .map(|c| {
            let t = &c["team"];
            let color = if truthy(&t["color"]) {
                let col = js::to_string(&t["color"]);
                if col.starts_with('#') {
                    col
                } else {
                    format!("#{col}")
                }
            } else {
                "#1a73e8".to_string()
            };
            TeamInfo {
                id: team_id(c),
                name: str_of(first(&[&t["displayName"], &t["name"]])),
                abbr: str_of(&t["abbreviation"]),
                logo: opt_str(first(&[&t["logos"][0]["href"], &t["logo"]])),
                color,
                score: str_of(&c["score"]),
                home_away: if c["homeAway"].as_str() == Some("home") { "home" } else { "away" }.to_string(),
                winner: is_winner(c),
                squad: squad_from_roster(roster(&team_id(c))),
            }
        })
        .collect();

    let mut dismissal_map = HashMap::new();
    for b in balls {
        if let (true, Some(bat), Some(text)) = (b.is_wicket, &b.batsman, &b.dismissal_text) {
            if !text.is_empty() {
                dismissal_map.insert(bat.id.clone(), clean_dismissal(text));
            }
        }
    }

    let mut innings: Vec<Innings> = Vec::new();
    for c in competitors {
        for ls in arr(&c["linescores"]) {
            if !truthy(&ls["isBatting"]) {
                continue;
            }
            let period = num(&ls["period"]);
            let s = stat_map(&ls["statistics"]);
            let tid = team_id(c);
            let bowling_id = competitors.iter().map(team_id).find(|o| *o != tid).unwrap_or_default();
            let (over_summaries, fow) = build_over_summaries(balls, period);
            let (w, nb, by, lb) = (
                num(stat(&s, "wides")),
                num(stat(&s, "noballs")),
                num(stat(&s, "byes")),
                num(stat(&s, "legbyes")),
            );
            let extras_total = num(stat(&s, "extras"));
            innings.push(Innings {
                number: period,
                team_abbr: str_of(&c["team"]["abbreviation"]),
                team_name: str_of(&c["team"]["displayName"]),
                runs: num(&ls["runs"]),
                wickets: num(&ls["wickets"]),
                overs: num(&ls["overs"]),
                target: num(&ls["target"]),
                ball_limit: num(stat(&s, "ballLimit")),
                is_current: num(&ls["isCurrent"]) == 1.0,
                description: str_of(&ls["description"]),
                batting: batting_for(roster(&tid), period, &dismissal_map),
                bowling: bowling_for(roster(&bowling_id), period),
                extras: Extras {
                    wides: w,
                    noballs: nb,
                    byes: by,
                    legbyes: lb,
                    total: if extras_total != 0.0 { extras_total } else { w + nb + by + lb },
                },
                fow,
                over_summaries,
                team_id: tid,
            });
        }
    }
    innings.sort_by(|a, b| cmp(a.number, b.number));
    let cur = innings.iter().find(|i| i.is_current).or_else(|| innings.last());

    let mut sorted: Vec<&Ball> = balls.iter().collect();
    sorted.sort_by(|a, b| cmp(a.seq, b.seq));
    let last_ball = sorted.last().copied();
    let cur_balls: Vec<&Ball> = cur.map_or_else(Vec::new, |c| sorted.iter().copied().filter(|b| b.innings == c.number).collect());
    let last_cur = cur_balls.last().copied();

    let mut current_batters: Vec<BatterLine> = Vec::new();
    if let Some(c) = cur {
        if let Some(l) = last_cur {
            for bb in [&l.batsman, &l.non_striker].into_iter().flatten() {
                if let Some(line) = c.batting.iter().find(|x| x.id == bb.id) {
                    if line.not_out {
                        current_batters.push(line.clone());
                    }
                }
            }
        }
        if current_batters.len() < 2 {
            for b in c.batting.iter().filter(|b| b.not_out && b.batted) {
                if !current_batters.iter().any(|x| x.id == b.id) {
                    current_batters.push(b.clone());
                }
            }
        }
        if current_batters.is_empty() {
            if let Some(l) = last_cur {
                for bb in [&l.batsman, &l.non_striker].into_iter().flatten() {
                    current_batters.push(BatterLine {
                        id: bb.id.clone(),
                        name: bb.name.clone(),
                        position: 0.0,
                        runs: bb.runs,
                        balls: bb.balls,
                        fours: bb.fours,
                        sixes: bb.sixes,
                        sr: if bb.balls != 0.0 { bb.runs / bb.balls * 100.0 } else { 0.0 },
                        dismissal: "not out".into(),
                        not_out: true,
                        batted: true,
                        ..BatterLine::default()
                    });
                }
            }
        }
        current_batters.truncate(2);
    }

    let current_bowler = match (cur, last_cur.and_then(|l| l.bowler.as_ref())) {
        (Some(c), Some(bw)) => Some(c.bowling.iter().find(|b| b.id == bw.id).cloned().unwrap_or_else(|| BowlerLine {
            id: bw.id.clone(),
            name: bw.name.clone(),
            headshot: None,
            overs: bw.overs,
            maidens: bw.maidens,
            conceded: bw.conceded,
            wickets: bw.wickets,
            econ: if bw.overs != 0.0 {
                bw.conceded / (overs_to_balls(bw.overs, 6.0) / 6.0)
            } else {
                0.0
            },
            wides: 0.0,
            noballs: 0.0,
            dots: 0.0,
        })),
        _ => None,
    };

    let mut partnership = RunsBalls::default();
    if !cur_balls.is_empty() {
        let last_w = cur_balls.iter().rposition(|b| b.is_wicket);
        let since = &cur_balls[last_w.map_or(0, |i| i + 1)..];
        let base = last_w.map_or(0.0, |i| cur_balls[i].innings_runs);
        partnership = RunsBalls {
            runs: since.last().map_or(base, |b| b.innings_runs) - base,
            balls: since.iter().filter(|b| b.is_legal()).count() as f64,
        };
    }

    let cur_stats = cur
        .and_then(|cu| {
            let c = competitors.iter().find(|x| team_id(x) == cu.team_id)?;
            arr(&c["linescores"]).iter().find(|l| num(&l["period"]) == cu.number)
        })
        .map_or_else(Map::new, |ls| stat_map(&ls["statistics"]));

    let crr = num_or(stat(&cur_stats, "runRate"), last_ball.map_or(0.0, |b| b.run_rate));
    let target = cur.map_or(0.0, |c| c.target);
    let mut need = None;
    let mut rrr = None;
    if let Some(c) = cur {
        if target > 0.0 && state == "in" {
            let limit = if c.ball_limit != 0.0 {
                c.ball_limit
            } else {
                last_ball.map_or(0.0, |b| b.ball_limit)
            };
            let used = num_or(stat(&cur_stats, "balls"), overs_to_balls(c.overs, 6.0));
            let remaining = if limit != 0.0 { (limit - used).max(0.0) } else { 0.0 };
            let n = RunsBalls {
                runs: (target - c.runs).max(0.0),
                balls: remaining,
            };
            rrr = Some(num_or(
                stat(&cur_stats, "requiredRunRate"),
                if remaining != 0.0 { n.runs / remaining * 6.0 } else { 0.0 },
            ));
            need = Some(n);
        }
    }

    let notes = arr(&summary["notes"]);
    let toss = notes
        .iter()
        .find(|n| n["type"].as_str() == Some("toss"))
        .map_or_else(String::new, |n| str_of(&n["text"]));
    let match_notes: Vec<String> = notes
        .iter()
        .filter(|n| n["type"].as_str() == Some("matchnote"))
        .map(|n| strip_html(&str_of(&n["text"])))
        .collect();
    let keep_from = match_notes.len().saturating_sub(12);
    let names = teams.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(" v ");
    let start = str_of(first(&[&comp["date"], &header["date"]]));
    let current_innings = cur.map_or(0.0, |c| c.number);
    let batting_team_id = cur.map(|c| c.team_id.clone());
    let recent_from = sorted.len().saturating_sub(60);
    let recent_balls: Vec<Ball> = sorted[recent_from..].iter().map(|b| (*b).clone()).collect();

    MatchDetail {
        key: format!("{league_id}:{event_id}"),
        id: event_id.to_string(),
        league_id: league_id.to_string(),
        title: if names.is_empty() { str_of(&header["name"]) } else { names },
        series: str_of(first(&[&header["league"]["name"], &header["leagues"][0]["name"]])),
        description: str_of(first(&[&comp["description"], &header["description"]])),
        venue: str_of(&summary["gameInfo"]["venue"]["fullName"]),
        toss,
        start_date: (!start.is_empty()).then_some(start),
        state,
        status_text: str_of(first(&[&status["type"]["description"], &status["type"]["detail"]])),
        summary: str_of(&status["summary"]),
        teams,
        current_innings,
        batting_team_id,
        recent_balls,
        current_batters,
        current_bowler,
        partnership,
        crr,
        rrr,
        need,
        notes: match_notes[keep_from..].to_vec(),
        last_updated: now,
        is_demo: None,
        innings,
    }
}
