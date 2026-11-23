//! Holds the Rust engine to what the original TypeScript produced (see `rust/golden/record.ts`).
//! Set GOLDEN_DUMP=<dir> to write each mismatching output for diffing.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use base64::Engine;
use cricstudio_engine::js::stringify;
use cricstudio_engine::*;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn fx(name: &str) -> Value {
    let p = root().join("packages/cricket-engine/test/fixtures").join(name);
    serde_json::from_slice(&fs::read(p).expect("fixture")).expect("fixture json")
}

fn canon(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(canon).collect()),
        Value::Object(o) => {
            let sorted: BTreeMap<&String, &Value> = o.iter().collect();
            let mut out = Map::new();
            for (k, x) in sorted {
                out.insert(k.clone(), canon(x));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

struct Golden {
    manifest: BTreeMap<String, String>,
    seen: usize,
    failed: Vec<String>,
}

impl Golden {
    fn load() -> Self {
        let p = root().join("rust/engine/tests/golden/manifest.json");
        let manifest = serde_json::from_slice(&fs::read(p).expect("manifest")).expect("manifest json");
        Self {
            manifest,
            seen: 0,
            failed: Vec::new(),
        }
    }

    fn check<T: Serialize + ?Sized>(&mut self, name: &str, value: &T) {
        let s = stringify(value).expect("serialise");
        let sha = format!("{:x}", Sha256::digest(s.as_bytes()));
        self.seen += 1;
        if self.manifest.get(name) != Some(&sha) {
            self.failed.push(name.to_string());
            if let Ok(dir) = std::env::var("GOLDEN_DUMP") {
                fs::create_dir_all(&dir).expect("dump dir");
                fs::write(PathBuf::from(dir).join(format!("{name}.json")), s).expect("dump");
            }
        }
    }
}

fn all_balls(pages: &[Value]) -> Vec<Ball> {
    let mut all: Vec<Ball> = pages.iter().flat_map(normalize_balls).collect();
    all.sort_by(|a, b| a.seq.partial_cmp(&b.seq).expect("seq"));
    all
}

#[test]
fn engine_matches_original() {
    let mut g = Golden::load();
    let pages: Vec<Value> = (1..=8).map(|i| fx(&format!("pbp{i}.json"))).collect();
    let all = all_balls(&pages);
    let summary = fx("summary.json");

    g.check("scorepanel", &normalize_scorepanel(&fx("scorepanel.json")));
    for (i, p) in pages.iter().enumerate() {
        g.check(&format!("balls_page{}", i + 1), &normalize_balls(p));
    }
    g.check("balls_all", &all);
    for inn in 1..=3 {
        let (overs, fow) = build_over_summaries(&all, f64::from(inn));
        g.check(&format!("overs_innings{inn}"), &json!({"overs": overs, "fow": fow}));
    }
    let full = build_match_detail("24289", "1529233", &summary, &all, 0.0);
    g.check("detail_full", &full);
    g.check("detail_no_balls", &build_match_detail("l", "e", &summary, &[], 0.0));
    g.check("detail_empty_summary", &build_match_detail("l", "e", &json!({}), &all, 0.0));
    let mut n = 5;
    while n < all.len() {
        g.check(&format!("detail_prefix_{n}"), &build_match_detail("l", "e", &summary, &all[..n], 0.0));
        n += 13;
    }

    for chunk in [1usize, 7, 40] {
        let mut det = EventDetector::new("24289:1529233");
        det.process(&all[..10], "in", 1000.0);
        let mut out: Vec<Vec<CricketEvent>> = Vec::new();
        let mut n = 10 + chunk;
        loop {
            out.push(det.process(&all[..n.min(all.len())], "in", 1000.0));
            if n >= all.len() {
                break;
            }
            n += chunk;
        }
        out.push(det.process(&all, "post", 2000.0));
        out.push(det.process(&all, "post", 3000.0));
        g.check(&format!("events_chunk{chunk}"), &canon(&serde_json::to_value(&out).expect("value")));
    }

    let mut demo = DemoReplay::new(0);
    let total = demo.total();
    assert_eq!(g.manifest.get("demo_total"), Some(&total.to_string()));
    for c in 0..=total {
        demo.cursor = c;
        g.check(&format!("demo_detail_{c}"), &demo.detail(0.0));
        if c % 25 == 0 {
            let mut item = demo.list_item(0.0);
            item.start_date = String::new();
            g.check(&format!("demo_item_{c}"), &item);
        }
    }

    let demo_detail = DemoReplay::new(150).detail(0.0);
    g.check("facts_full", &facts::match_facts(Some(&full), None, 0.0));
    g.check("facts_demo", &facts::match_facts(Some(&demo_detail), None, 0.0));
    g.check("facts_none", &facts::match_facts(None, None, 0.0));
    g.check("hints_full", &media::cricket_hints(Some(&full)));
    g.check("hints_none", &media::cricket_hints(None));
    let wicket = all.iter().find(|b| b.is_wicket).expect("wicket");
    let samples = [&all[0], &all[50], wicket, all.last().expect("ball")];
    let ev_facts: Vec<String> = samples
        .iter()
        .map(|b| {
            let ev = CricketEvent {
                kind: "FOUR".into(),
                match_key: "k".into(),
                ball: Some((*b).clone()),
                value: Some(4.0),
                player: b.batsman.as_ref().map(|x| x.name.clone()),
                title: "FOUR!".into(),
                subtitle: Some(b.short.clone()),
                ts: 1.0,
            };
            facts::event_facts(Some(&ev), Some(&full))
        })
        .collect();
    g.check("event_facts", &ev_facts);
    let mut pre = full.clone();
    pre.state = "pre".into();
    g.check(
        "event_facts_quiet",
        &[
            facts::event_facts(None, Some(&full)),
            facts::event_facts(None, Some(&pre)),
            facts::event_facts(None, None),
        ],
    );
    g.check("silent_wav", &base64::engine::general_purpose::STANDARD.encode(media::silent_wav(0.5)));

    let expected = g.manifest.keys().filter(|k| k.as_str() != "demo_total").count();
    assert_eq!(g.seen, expected, "every recorded output must be checked");
    assert!(
        g.failed.is_empty(),
        "{} of {} differ, first: {:?}",
        g.failed.len(),
        g.seen,
        &g.failed[..g.failed.len().min(8)]
    );
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

#[test]
fn pure_functions_match_original() {
    let text = fs::read_to_string(root().join("rust/engine/tests/golden/pure.jsonl")).expect("pure cases");
    let (mut total, mut bad) = (0, Vec::new());
    for line in text.lines() {
        let case: Value = serde_json::from_str(line).expect("case");
        let a = case["args"].as_array().expect("args");
        let got: Value = match s(&case["fn"]) {
            "decodeEntities" => json!(decode_entities(s(&a[0]))),
            "stripHtml" => json!(strip_html(s(&a[0]))),
            "cleanDismissal" => json!(clean_dismissal(s(&a[0]))),
            "speakable" => json!(media::speakable(s(&a[0]))),
            "oversToBalls" => json!(overs_to_balls(a[0].as_f64().unwrap(), a[1].as_f64().unwrap())),
            "ballsToOvers" => json!(balls_to_overs(a[0].as_f64().unwrap(), a[1].as_f64().unwrap())),
            "ballLabel" => json!(ball_label(s(&a[0]), a[1].as_f64().unwrap(), a[2].as_f64().unwrap())),
            "targetCode" => json!(media::target_code(a[0].as_str())),
            "preferVideoCopy" => json!(media::prefer_video_copy(s(&a[0]))),
            "rtmpUrl" => json!(media::rtmp_url(s(&a[0]["url"]), s(&a[0]["key"]))),
            "relayArgs" => json!(media::relay_args(s(&a[0]))),
            "encoderArgs" => json!(media::encoder_args(
                a[0].as_f64().unwrap(),
                a[1].as_f64().unwrap(),
                a[2].as_f64().unwrap(),
                s(&a[3]),
                a[4].as_bool().unwrap()
            )),
            "canEditBubble" => json!(bubbles::can_edit_bubble(a[0].as_str(), s(&a[1]), s(&a[2]))),
            "applyBubblePatch" => Value::Object(bubbles::apply_bubble_patch(a[0].as_object(), s(&a[1]), &a[2])),
            "sanitizeBubbleFields" => bubbles::sanitize_bubble_fields(&a[0], &a[1]),
            other => panic!("unhandled case {other}"),
        };
        total += 1;
        let same = stringify(&got).unwrap() == stringify(&case["result"]).unwrap();
        if !same {
            bad.push(format!(
                "{}({}) = {} want {}",
                s(&case["fn"]),
                stringify(&case["args"]).unwrap(),
                stringify(&got).unwrap(),
                stringify(&case["result"]).unwrap()
            ));
        }
    }
    assert!(total > 500);
    assert!(bad.is_empty(), "{} of {total} differ:\n{}", bad.len(), bad[..bad.len().min(12)].join("\n"));
}
