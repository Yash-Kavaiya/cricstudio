//! CricStudio's cricket engine, ported from `packages/cricket-engine` and the pure parts of
//! `packages/shared` and `apps/server`. Output is held to the original by `tests/golden.rs`.

pub mod bubbles;
pub mod demo;
pub mod detect;
pub mod facts;
pub mod js;
pub mod media;
pub mod normalize;
pub mod types;

pub use demo::{DemoReplay, DEMO_KEY};
pub use detect::EventDetector;
pub use normalize::{
    ball_label, balls_to_overs, build_match_detail, build_over_summaries, clean_dismissal, decode_entities, normalize_balls, normalize_scorepanel,
    overs_to_balls, strip_html,
};
pub use types::*;
