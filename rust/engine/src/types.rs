//! Wire types shared with the browser. Field order follows the original object literals.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchListTeam {
    pub id: String,
    pub name: String,
    pub abbr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub score: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner: Option<bool>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchListItem {
    pub id: String,
    pub league_id: String,
    pub league_name: String,
    pub name: String,
    pub description: String,
    pub state: String,
    pub status_text: String,
    pub start_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_demo: Option<bool>,
    pub teams: Vec<MatchListTeam>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BallBatter {
    pub id: String,
    pub name: String,
    pub runs: f64,
    pub balls: f64,
    pub fours: f64,
    pub sixes: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BallBowler {
    pub id: String,
    pub name: String,
    pub overs: f64,
    pub conceded: f64,
    pub wickets: f64,
    pub maidens: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ball {
    pub id: String,
    pub seq: f64,
    pub innings: f64,
    pub over: f64,
    pub over_number: f64,
    pub ball_in_over: f64,
    #[serde(rename = "type")]
    pub kind: String,
    pub runs: f64,
    pub bat_runs: f64,
    pub is_wicket: bool,
    pub label: String,
    pub short: String,
    pub text: String,
    pub batting_team_id: String,
    pub batting_team_abbr: String,
    pub innings_runs: f64,
    pub innings_wickets: f64,
    pub run_rate: f64,
    pub remaining_balls: f64,
    pub ball_limit: f64,
    pub target: f64,
    pub over_runs: f64,
    pub over_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batsman: Option<BallBatter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub non_striker: Option<BallBatter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bowler: Option<BallBowler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissal_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissal_type: Option<String>,
    pub ts: f64,
}

impl Ball {
    /// Wides and no-balls do not count as a legal delivery.
    pub fn is_legal(&self) -> bool {
        self.kind != "wide" && self.kind != "noball"
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BatterLine {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headshot: Option<String>,
    pub position: f64,
    pub runs: f64,
    pub balls: f64,
    pub fours: f64,
    pub sixes: f64,
    pub sr: f64,
    pub dismissal: String,
    pub not_out: bool,
    pub batted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wagon: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dot_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_shot: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BowlerLine {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headshot: Option<String>,
    pub overs: f64,
    pub maidens: f64,
    pub conceded: f64,
    pub wickets: f64,
    pub econ: f64,
    pub wides: f64,
    pub noballs: f64,
    pub dots: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FallOfWicket {
    pub wicket: f64,
    pub runs: f64,
    pub over: f64,
    pub batter: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OverSummary {
    pub innings: f64,
    pub over: f64,
    pub runs: f64,
    pub wickets: f64,
    pub cumulative: f64,
    pub balls: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Extras {
    pub wides: f64,
    pub noballs: f64,
    pub byes: f64,
    pub legbyes: f64,
    pub total: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Innings {
    pub number: f64,
    pub team_id: String,
    pub team_abbr: String,
    pub team_name: String,
    pub runs: f64,
    pub wickets: f64,
    pub overs: f64,
    pub target: f64,
    pub ball_limit: f64,
    pub is_current: bool,
    pub description: String,
    pub batting: Vec<BatterLine>,
    pub bowling: Vec<BowlerLine>,
    pub extras: Extras,
    pub fow: Vec<FallOfWicket>,
    pub over_summaries: Vec<OverSummary>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SquadPlayer {
    pub id: String,
    pub name: String,
    pub role: String,
    pub captain: bool,
    pub keeper: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headshot: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TeamInfo {
    pub id: String,
    pub name: String,
    pub abbr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub color: String,
    pub score: String,
    pub home_away: String,
    pub winner: bool,
    pub squad: Vec<SquadPlayer>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RunsBalls {
    pub runs: f64,
    pub balls: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchDetail {
    pub key: String,
    pub id: String,
    pub league_id: String,
    pub title: String,
    pub series: String,
    pub description: String,
    pub venue: String,
    pub toss: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    pub state: String,
    pub status_text: String,
    pub summary: String,
    pub teams: Vec<TeamInfo>,
    pub innings: Vec<Innings>,
    pub current_innings: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batting_team_id: Option<String>,
    pub recent_balls: Vec<Ball>,
    pub current_batters: Vec<BatterLine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_bowler: Option<BowlerLine>,
    pub partnership: RunsBalls,
    pub crr: f64,
    pub rrr: Option<f64>,
    pub need: Option<RunsBalls>,
    pub notes: Vec<String>,
    pub last_updated: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_demo: Option<bool>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CricketEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub match_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ball: Option<Ball>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub ts: f64,
}
