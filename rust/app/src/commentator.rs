//! Template-driven, context-aware commentary (port of `commentary/commentator.ts`).

use std::sync::LazyLock;

use cricstudio_engine::facts::minutes_to_start;
use cricstudio_engine::js::{self, now_ms, num_str as n, to_fixed};
use cricstudio_engine::{CricketEvent, Innings, MatchDetail, TeamInfo};
use rand::seq::SliceRandom;
use rand::Rng;
use regex::Regex;

const FOUR: &[&str] = &[
    "Shot! {bat} finds the gap and that races away to the boundary. Four runs.",
    "Oh, that is gorgeous from {bat}! Timed to perfection, four more.",
    "Cracking shot! {bat} threads it through the field, and nobody is stopping that. Four.",
    "That's a boundary! {bat} puts it away. {team} move to {score}.",
    "Lovely, lovely cricket. {bat} leans into it and it's four all the way.",
];
const SIX: &[&str] = &[
    "That is huge! {bat} has launched it into the stands. Six!",
    "Oh my word! {bat} has sent that into orbit. Maximum!",
    "Gone, gone, all the way! {bat} clears the rope with ease. That's six!",
    "Smashed! {bat} picks the length early and deposits it into the crowd. Six runs!",
    "What a hit! The crowd is on its feet. {bat} with a massive six, and {team} are {score}.",
];
const WICKET: &[&str] = &[
    "Gone! That's a big wicket. {dismissal}. {team} are {score}.",
    "Out! The bowler gets the breakthrough. {dismissal}.",
    "And that's the end of {bat}! {dismissal}. Huge moment in this game.",
    "Wicket! {bowler} strikes, and {bat} has to walk back. {team} now {score}.",
];
const OVER_END: &[&str] = &[
    "End of the over. {overRuns} from it, and {team} are {score} after {overs} overs.",
    "That completes the over. {overRuns} runs, {team} {score}.",
    "{overRuns} off that over. Let's take stock: {team} {score} after {overs}.",
];
const MILESTONE_50: &[&str] = &[
    "Fifty up for {bat}! A terrific knock, raise the bat, take a bow.",
    "And there it is, a half-century for {bat}! Quality innings.",
];
const MILESTONE_100: &[&str] = &[
    "Century! What an innings from {bat}! Absolutely magnificent, take a bow!",
    "A hundred for {bat}! The helmet comes off, the bat goes up, and this place erupts!",
];
const FIVE_FOR: &[&str] = &["Five wickets! {bowler} has a five-for, and what a spell this has been!"];
const PARTNERSHIP: &[&str] = &[
    "That brings up the {value} partnership. These two are building something special.",
    "The {value} stand is up, and the bowlers need answers.",
];
const HATTRICK: &[&str] = &["Two in two! {bowler} is on a hat-trick. Everyone's on the edge of their seats."];
const NOBALL: &[&str] = &["No ball! And that means a free hit is coming up. Here's a chance for the batter."];
const INNINGS_END: &[&str] = &[
    "That's the end of the innings. Stay with us, the experts are about to break it all down.",
    "And the innings is complete. What a contest so far. Let's take a short break.",
];
const MATCH_END: &[&str] = &[
    "And that's the match! {summary}. What a game of cricket that was!",
    "It is all over! {summary}. Thanks for watching with us.",
];

const EVENT_ORDER: [&str; 11] = [
    "MATCH_END",
    "INNINGS_END",
    "WICKET",
    "MILESTONE_BAT",
    "MILESTONE_BOWL",
    "HATTRICK_WATCH",
    "SIX",
    "FOUR",
    "PARTNERSHIP",
    "NOBALL",
    "OVER_END",
];

/// A line ready to be written (optionally by AI) and spoken.
#[derive(Clone, Debug)]
pub struct Speak {
    pub text: String,
    pub priority: i32,
    pub event: Option<CricketEvent>,
    pub recent: Vec<String>,
}

pub struct Ctx<'a> {
    pub enabled: bool,
    pub chatter_seconds: f64,
    pub detail: Option<&'a MatchDetail>,
    pub poll: &'a str,
    pub countdown_to: Option<f64>,
}

fn pick<'a>(items: &[&'a str]) -> &'a str {
    items.choose(&mut rand::thread_rng()).copied().unwrap_or("")
}

fn sides(d: &MatchDetail) -> (String, String) {
    let name = |i: usize, fallback: &str| {
        d.teams
            .get(i)
            .map(|t| t.name.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fallback.to_string())
    };
    (name(0, "the home side"), name(1, "the visitors"))
}

fn venue_short(d: &MatchDetail) -> String {
    js::trim(d.venue.split(',').next().unwrap_or("")).to_string()
}

fn at_venue(d: &MatchDetail) -> String {
    if d.venue.is_empty() {
        String::new()
    } else {
        format!(" at {}", venue_short(d))
    }
}

fn captain_of(t: Option<&TeamInfo>) -> Option<String> {
    t?.squad.iter().find(|p| p.captain).map(|p| p.name.clone())
}

fn player_of(t: Option<&TeamInfo>) -> Option<String> {
    let pool: Vec<&str> = t?.squad.iter().filter(|p| !p.captain).map(|p| p.name.as_str()).collect();
    pool[..pool.len().min(7)].choose(&mut rand::thread_rng()).map(|s| (*s).to_string())
}

fn in_minutes(m: f64) -> String {
    if m >= 120.0 {
        format!("about {} hours", n(js::round(m / 60.0)))
    } else if m >= 60.0 {
        format!("about an hour{}", if m >= 75.0 { " and a bit" } else { "" })
    } else if m == 1.0 {
        "about a minute".into()
    } else {
        format!("{} minutes", n(m))
    }
}

fn poll_line(d: &MatchDetail, poll: &str) -> String {
    static DEFAULT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^who wins this match\??").expect("static regex"));
    let (a, b) = sides(d);
    if poll.is_empty() || DEFAULT.is_match(poll) {
        format!("Fan poll time: who wins this one, {a} or {b}? Vote in the chat!")
    } else {
        format!("Time for our fan poll: {poll} Drop your answer in the chat!")
    }
}

fn current(d: &MatchDetail) -> Option<&Innings> {
    d.innings.iter().find(|i| i.number == d.current_innings)
}

fn batting_name(d: &MatchDetail, fallback: &str) -> String {
    d.teams
        .iter()
        .find(|t| Some(&t.id) == d.batting_team_id.as_ref())
        .map_or_else(|| fallback.to_string(), |t| t.name.clone())
}

const PRE_MATCH: usize = 10;
const LIVE_MATCH: usize = 13;
const AFTER_MATCH: usize = 2;

fn pre_match(i: usize, d: &MatchDetail, poll: &str, cd: Option<f64>) -> Option<String> {
    let (a, b) = sides(d);
    match i {
        0 => {
            let m = minutes_to_start(Some(d), cd, now_ms())?;
            Some(format!(
                "We're {} away from {a} against {b}{}. Grab your snacks and stay right here!",
                in_minutes(m),
                at_venue(d)
            ))
        }
        1 => {
            if d.description.is_empty() && d.series.is_empty() {
                return None;
            }
            let what = if d.description.is_empty() { "big game" } else { &d.description };
            let of = if d.series.is_empty() {
                String::new()
            } else {
                format!(" of the {}", d.series)
            };
            Some(format!("{a} and {b} meet in the {what}{of}. Plenty riding on this one."))
        }
        2 => (!d.venue.is_empty()).then(|| {
            format!(
                "What's a winning total at {} today? Drop your par score in the chat before the first ball.",
                venue_short(d)
            )
        }),
        3 => Some(format!(
            "So, who are you backing today, {a} or {b}? Tell us in the comments, and tell us where you're watching from!"
        )),
        4 => {
            let (ca, cb) = (
                captain_of(d.teams.first()).filter(|s| !s.is_empty())?,
                captain_of(d.teams.get(1)).filter(|s| !s.is_empty())?,
            );
            Some(format!("{ca} leads {a}, {cb} captains {b}. Which skipper wins the tactical battle today?"))
        }
        5 => Some(if d.toss.is_empty() {
            format!(
                "The toss is coming up{}. If you were the captain, bat first or bowl first? Let us know!",
                at_venue(d)
            )
        } else {
            format!(
                "Toss news: {}. Good call, or would you have done the opposite?",
                d.toss.strip_suffix('.').unwrap_or(&d.toss)
            )
        }),
        6 => {
            let (pa, pb) = (
                player_of(d.teams.first()).filter(|s| !s.is_empty())?,
                player_of(d.teams.get(1)).filter(|s| !s.is_empty())?,
            );
            Some(format!("Players to watch: {pa} for {a} and {pb} for {b}. Who makes the bigger impact today?"))
        }
        7 => Some(format!(
            "Make your call before the first ball: who's your player of the match in {a} versus {b}?"
        )),
        8 => Some(poll_line(d, poll)),
        _ => Some(format!(
            "Welcome to everyone joining us for {a} versus {b}! Say hi in the chat, and hit like if you're excited for this one."
        )),
    }
}

fn live_match(i: usize, d: &MatchDetail, poll: &str) -> Option<String> {
    let (a, b) = sides(d);
    match i {
        0 => {
            let need = d.need.filter(|x| x.balls > 0.0)?;
            let (runs, balls) = (n(need.runs), n(need.balls));
            let team = batting_name(d, "The chasing side");
            let rrr = d.rrr.filter(|r| *r != 0.0).map_or_else(String::new, |r| to_fixed(r, 1));
            let rate = need.runs / need.balls.max(1.0);
            Some(if rate > 1.8 {
                format!("{team} need {runs} from {balls} balls. The required rate is {rrr}, and it's getting really tough now.")
            } else if rate < 0.9 {
                format!("{team} are cruising. Just {runs} needed from {balls} balls. The bowling side needs wickets, and fast.")
            } else {
                format!("Here's the equation: {runs} runs from {balls} balls. This one is going right down to the wire!")
            })
        }
        1 => {
            let need = d.need.filter(|x| x.balls > 0.0)?;
            let team = batting_name(d, "the chasing side");
            Some(format!(
                "{} needed from {}. Can {team} get there? Yes or no in the comments!",
                n(need.runs),
                n(need.balls)
            ))
        }
        2 => {
            let x = d.current_batters.first()?;
            Some(match d.current_batters.get(1) {
                Some(y) => format!(
                    "{} is on {} from {}, {} has {}. The partnership is worth {} off {} balls.",
                    x.name,
                    n(x.runs),
                    n(x.balls),
                    y.name,
                    n(y.runs),
                    n(d.partnership.runs),
                    n(d.partnership.balls)
                ),
                None => format!("{} is batting on {} from {} balls.", x.name, n(x.runs), n(x.balls)),
            })
        }
        3 => {
            let bat = d.current_batters.first().filter(|x| x.runs >= 15.0)?;
            let bw = d.current_bowler.as_ref()?;
            Some(format!(
                "{} has {}. Does this become a big one, or does {} strike next? Your call in the chat!",
                bat.name,
                n(bat.runs),
                bw.name
            ))
        }
        4 => {
            let bw = d.current_bowler.as_ref()?;
            Some(format!(
                "{} has figures of {} for {} from {} overs, going at {} an over.",
                bw.name,
                n(bw.wickets),
                n(bw.conceded),
                n(bw.overs),
                to_fixed(bw.econ, 1)
            ))
        }
        5 => {
            let inn = current(d).filter(|_| d.need.is_none())?;
            let balls = inn.overs.floor() * 6.0 + js::round((inn.overs % 1.0) * 10.0);
            if inn.ball_limit == 0.0 || balls < 12.0 {
                return None;
            }
            let proj = js::round(inn.runs / balls * inn.ball_limit);
            Some(format!(
                "At this rate, {} are heading for around {}{}. What would you call a par score here? Let us know in the comments!",
                inn.team_name,
                n(proj),
                at_venue(d)
            ))
        }
        6 => {
            let mut all: Vec<_> = d.innings.iter().flat_map(|i| i.batting.iter()).collect();
            all.sort_by(|x, y| y.runs.partial_cmp(&x.runs).unwrap_or(std::cmp::Ordering::Equal));
            let top = all.first().filter(|t| t.runs >= 20.0)?;
            Some(format!(
                "Top scorer so far, {}, with {} off {} balls, including {} sixes.",
                top.name,
                n(top.runs),
                n(top.balls),
                n(top.sixes)
            ))
        }
        7 => Some(format!("Right now, who's on top in this game, {a} or {b}? Vote in the chat!")),
        8 => Some(format!("Who's your player of the match so far in {a} versus {b}? Let us know in the chat.")),
        9 => Some(poll_line(d, poll)),
        10 => Some(match current(d) {
            None => format!("Welcome to everyone just joining us for {a} versus {b}. Tell us where you're watching from!"),
            Some(inn) => format!(
                "Welcome if you've just joined: {} are {} for {} after {} overs{}. Say hi in the chat!",
                inn.team_name,
                n(inn.runs),
                n(inn.wickets),
                n(inn.overs),
                at_venue(d)
            ),
        }),
        _ => Some(format!(
            "If you're enjoying {a} versus {b} with us, hit that like button and subscribe. It really helps the channel."
        )),
    }
}

fn after_match(i: usize, d: &MatchDetail) -> Option<String> {
    let (a, b) = sides(d);
    if i == 0 {
        (!d.summary.is_empty()).then(|| format!("That's the result: {}. Who was your player of the match? Tell us in the comments.", d.summary))
    } else {
        Some(format!("Thanks for watching {a} versus {b} with us. Hit like and subscribe for the next one!"))
    }
}

fn fill(tpl: &str, ev: Option<&CricketEvent>, d: Option<&MatchDetail>) -> String {
    static TAIL: LazyLock<Regex> = LazyLock::new(|| {
        let ws = js::JS_WS;
        Regex::new(&format!(r"{ws}[0-9]+{ws}\([^\n\r\u{{2028}}\u{{2029}}]*\z")).expect("static regex")
    });
    let b = ev.and_then(|e| e.ball.as_ref());
    let inn = d.and_then(current);
    let player = ev.and_then(|e| e.player.clone());
    let score = inn
        .map(|i| format!("{} for {}", n(i.runs), n(i.wickets)))
        .filter(|s| !s.is_empty())
        .or_else(|| b.map(|x| format!("{} for {}", n(x.innings_runs), n(x.innings_wickets))))
        .unwrap_or_default();
    let replacements = [
        (
            "{bat}",
            b.and_then(|x| x.batsman.as_ref().map(|y| y.name.clone()))
                .or_else(|| player.clone())
                .unwrap_or_else(|| "the batter".into()),
        ),
        (
            "{bowler}",
            b.and_then(|x| x.bowler.as_ref().map(|y| y.name.clone()))
                .or_else(|| player.clone())
                .unwrap_or_else(|| "the bowler".into()),
        ),
        (
            "{team}",
            inn.map(|i| i.team_name.clone())
                .or_else(|| b.map(|x| x.batting_team_abbr.clone()))
                .unwrap_or_else(|| "the batting side".into()),
        ),
        ("{score}", score),
        ("{overs}", inn.map(|i| n(i.overs)).or_else(|| b.map(|x| n(x.over))).unwrap_or_default()),
        ("{overRuns}", n(b.map_or(0.0, |x| x.over_runs))),
        (
            "{dismissal}",
            TAIL.replace(ev.and_then(|e| e.subtitle.as_deref()).unwrap_or(""), "").into_owned(),
        ),
        ("{value}", ev.and_then(|e| e.value).map_or_else(String::new, n)),
        (
            "{summary}",
            d.map(|x| x.summary.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "a fantastic finish".into()),
        ),
    ];
    let mut out = tpl.to_string();
    for (k, v) in replacements {
        out = out.replace(k, &v);
    }
    out
}

#[derive(Default)]
pub struct Commentator {
    recent: Vec<String>,
    last_spoke: f64,
    seq: u64,
}

impl Commentator {
    pub fn next_id(&mut self, ts: f64) -> String {
        self.seq += 1;
        format!("c{}-{}", self.seq, n(ts))
    }

    pub fn remember(&mut self, text: &str) {
        self.recent.push(text.to_string());
        if self.recent.len() > 30 {
            self.recent.remove(0);
        }
    }

    fn speak(&mut self, text: String, priority: i32, event: Option<CricketEvent>) -> Option<Speak> {
        if text.is_empty() || self.recent.contains(&text) {
            return None;
        }
        self.remember(&text);
        self.last_spoke = now_ms();
        Some(Speak {
            text,
            priority,
            event,
            recent: self.recent.clone(),
        })
    }

    pub fn on_events(&mut self, events: &[CricketEvent], cx: &Ctx<'_>) -> Option<Speak> {
        if !cx.enabled {
            return None;
        }
        let ev = EVENT_ORDER.iter().find_map(|t| events.iter().find(|e| e.kind == *t))?;
        let (tpl, prio) = match ev.kind.as_str() {
            "FOUR" => (FOUR, 2),
            "SIX" => (SIX, 3),
            "WICKET" => (WICKET, 5),
            "OVER_END" => {
                if now_ms() - self.last_spoke < 12_000.0 || rand::thread_rng().gen::<f64>() < 0.35 {
                    return None;
                }
                (OVER_END, 1)
            }
            "MILESTONE_BAT" => (if ev.value.unwrap_or(0.0) >= 100.0 { MILESTONE_100 } else { MILESTONE_50 }, 4),
            "MILESTONE_BOWL" => (FIVE_FOR, 4),
            "PARTNERSHIP" => (PARTNERSHIP, 2),
            "HATTRICK_WATCH" => (HATTRICK, 4),
            "NOBALL" => (NOBALL, 1),
            "INNINGS_END" => (INNINGS_END, 5),
            "MATCH_END" => (MATCH_END, 6),
            _ => return None,
        };
        self.speak(fill(pick(tpl), Some(ev), cx.detail), prio, Some(ev.clone()))
    }

    /// Unprompted, context-aware lines during quiet spells.
    pub fn chatter(&mut self, cx: &Ctx<'_>) -> Option<Speak> {
        if !cx.enabled {
            return None;
        }
        let gap = cx.chatter_seconds * 1000.0 * (0.8 + rand::thread_rng().gen::<f64>() * 0.4);
        if now_ms() - self.last_spoke < gap {
            return None;
        }
        let d = cx.detail?;
        let count = match d.state.as_str() {
            "pre" => PRE_MATCH,
            "post" => AFTER_MATCH,
            _ => LIVE_MATCH,
        };
        let mut order: Vec<usize> = (0..count).collect();
        order.shuffle(&mut rand::thread_rng());
        for i in order {
            let line = match d.state.as_str() {
                "pre" => pre_match(i, d, cx.poll, cx.countdown_to),
                "post" => after_match(i, d),
                _ => live_match(i, d, cx.poll),
            };
            if let Some(l) = line.filter(|l| !self.recent.contains(l)) {
                return self.speak(l, 0, None);
            }
        }
        None
    }

    /// When autopilot starts or a new match is picked.
    pub fn intro(&mut self, title: &str, cx: &Ctx<'_>) -> Option<Speak> {
        if !cx.enabled {
            return None;
        }
        let Some(d) = cx.detail else {
            return self.speak(format!("Hello and welcome to {title}. Stay with us for live cricket."), 3, None);
        };
        let (a, b) = sides(d);
        let at = at_venue(d);
        if d.state == "pre" {
            let desc = if d.description.is_empty() {
                String::new()
            } else {
                format!(", the {}", d.description)
            };
            let first = minutes_to_start(Some(d), cx.countdown_to, now_ms()).map_or_else(String::new, |m| format!(" First ball in {}.", in_minutes(m)));
            return self.speak(
                format!("Hello and welcome to {title}! It's {a} against {b}{desc}{at}.{first} Who are you backing? Tell us in the chat!"),
                3,
                None,
            );
        }
        let desc = if d.description.is_empty() {
            String::new()
        } else {
            format!(", {}", d.description)
        };
        let line = format!("Hello and welcome to {title}! We're live with {a} versus {b}{desc}{at}. {}", d.summary);
        self.speak(js::trim(&line).to_string(), 3, None)
    }

    /// The host just started the Starting Soon countdown.
    pub fn countdown_set(&mut self, cx: &Ctx<'_>) -> Option<Speak> {
        let d = cx.detail.filter(|x| cx.enabled && x.state == "pre")?;
        let m = minutes_to_start(Some(d), cx.countdown_to, now_ms())?;
        let (a, b) = sides(d);
        self.speak(
            format!("The countdown is on! {a} versus {b} is {} away. Stay right here.", in_minutes(m)),
            2,
            None,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cricstudio_engine::DemoReplay;

    fn cx(d: &MatchDetail) -> Ctx<'_> {
        Ctx {
            enabled: true,
            chatter_seconds: 0.0,
            detail: Some(d),
            poll: "",
            countdown_to: None,
        }
    }

    #[test]
    fn no_placeholder_survives_in_any_line() {
        let d = DemoReplay::new(150).detail(0.0);
        let ball = d.recent_balls.last().cloned();
        for kind in [
            "FOUR",
            "SIX",
            "WICKET",
            "MILESTONE_BAT",
            "MILESTONE_BOWL",
            "PARTNERSHIP",
            "HATTRICK_WATCH",
            "NOBALL",
            "INNINGS_END",
            "MATCH_END",
        ] {
            let ev = CricketEvent {
                kind: kind.into(),
                ball: ball.clone(),
                value: Some(50.0),
                subtitle: Some("c X b Y 10 (5b)".into()),
                ..CricketEvent::default()
            };
            let line = Commentator::default().on_events(&[ev], &cx(&d)).expect("line");
            assert!(!line.text.contains('{'), "{}", line.text);
        }
    }

    #[test]
    fn chatter_is_about_this_match_and_never_repeats() {
        let d = DemoReplay::new(150).detail(0.0);
        let mut c = Commentator::default();
        let mut seen = Vec::new();
        while let Some(s) = c.chatter(&cx(&d)) {
            assert!(!seen.contains(&s.text));
            seen.push(s.text);
            c.last_spoke = 0.0;
        }
        assert!(seen.len() >= 8);
    }

    #[test]
    fn disabled_stays_silent() {
        let d = DemoReplay::new(150).detail(0.0);
        let off = Ctx { enabled: false, ..cx(&d) };
        assert!(Commentator::default().intro("Show", &off).is_none());
    }
}
