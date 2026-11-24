//! Server-side camera-frame sanitising (port of the parts of `shared/src/bubbles.ts` the server calls).

use serde_json::{json, Map, Value};

use crate::js::{self, to_number};

const PROGRAM_W: f64 = 1920.0;
const PROGRAM_H: f64 = 1080.0;
const CORNERS: [&str; 4] = ["br", "bl", "tr", "tl"];
const SHAPES: [&str; 8] = ["ball", "square", "rounded", "stumps", "wide", "oval", "diamond", "shield"];
const MAX_SLOTS: usize = 12;

pub fn is_shape(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| SHAPES.contains(&s))
}

fn clean_id(id: &str) -> String {
    let s = js::trim(id);
    let units = s.encode_utf16().count();
    if (1..=80).contains(&units) && !s.chars().any(js::is_js_ws) {
        s.to_string()
    } else {
        String::new()
    }
}

/// Host moves anyone. A guest moves only their own frame.
pub fn can_edit_bubble(role: Option<&str>, self_id: &str, target_id: &str) -> bool {
    if clean_id(target_id).is_empty() {
        return false;
    }
    role == Some("host") || (role == Some("guest") && self_id == target_id)
}

fn clamp_num(v: Option<&Value>, lo: f64, hi: f64) -> Option<f64> {
    let n = to_number(v);
    n.is_finite().then(|| n.max(lo).min(hi))
}

/// Merge one person's frame edit into the slot map. Drops junk and caps the map.
pub fn apply_bubble_patch(slots: Option<&Map<String, Value>>, participant_id: &str, patch: &Value) -> Map<String, Value> {
    let id = clean_id(participant_id);
    let mut next = Map::new();
    for (k, v) in slots.into_iter().flatten() {
        let key = clean_id(k);
        if !key.is_empty() {
            next.insert(key, v.clone());
        }
    }
    if id.is_empty() {
        return cap_slots(next);
    }
    if js::truthy(&patch["clear"]) {
        next.shift_remove(&id);
        return cap_slots(next);
    }
    let prev = next.get(&id).cloned().unwrap_or_else(|| json!({}));
    let mut slot = Map::new();
    if !js::truthy(&patch["clearPosition"]) {
        let (px, py) = (patch.get("x"), patch.get("y"));
        let from_patch = px.is_some() || py.is_some();
        let x = clamp_num(if from_patch { px } else { prev.get("x") }, -400.0, PROGRAM_W + 400.0);
        let y = clamp_num(if from_patch { py } else { prev.get("y") }, -400.0, PROGRAM_H + 400.0);
        if let (Some(x), Some(y)) = (x, y) {
            slot.insert("x".into(), json!(x));
            slot.insert("y".into(), json!(y));
        }
    }
    let shape = match patch.get("shape") {
        Some(Value::Null) => None,
        s if is_shape(s) => s.cloned(),
        _ => prev.get("shape").cloned(),
    };
    if let Some(s) = shape.filter(|s| is_shape(Some(s))) {
        slot.insert("shape".into(), s);
    }
    if slot.is_empty() {
        next.shift_remove(&id);
    } else {
        next.insert(id, Value::Object(slot));
    }
    cap_slots(next)
}

fn cap_slots(slots: Map<String, Value>) -> Map<String, Value> {
    if slots.len() <= MAX_SLOTS {
        return slots;
    }
    let skip = slots.len() - MAX_SLOTS;
    slots.into_iter().skip(skip).collect()
}

/// Clean the frame fields of a brand patch. Unknown values fall back to what is already saved.
pub fn sanitize_bubble_fields(next: &Value, prev: &Value) -> Value {
    let corner = next["camBubbleCorner"]
        .as_str()
        .filter(|c| CORNERS.contains(c))
        .map_or_else(|| prev["camBubbleCorner"].clone(), Value::from);
    let shape = if is_shape(next.get("camBubbleShape")) {
        next["camBubbleShape"].clone()
    } else {
        prev["camBubbleShape"].clone()
    };
    let size = clamp_num(next.get("camBubbleSize"), 120.0, 400.0).unwrap_or_else(|| js::num(&prev["camBubbleSize"]));
    let raw_slots = &next["camBubbleSlots"];
    let slots = if js::truthy(raw_slots) && (raw_slots.is_object() || raw_slots.is_array()) {
        let entries: Vec<(String, &Value)> = match raw_slots {
            Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), v)).collect(),
            Value::Array(a) => a.iter().enumerate().map(|(i, v)| (i.to_string(), v)).collect(),
            _ => Vec::new(),
        };
        let mut out = Map::new();
        for (id, raw) in entries.into_iter().take(MAX_SLOTS) {
            if !(raw.is_object() || raw.is_array()) {
                continue;
            }
            let mut patch = Map::new();
            if let Some(x) = raw.get("x") {
                patch.insert("x".into(), x.clone());
            }
            if let Some(y) = raw.get("y") {
                patch.insert("y".into(), y.clone());
            }
            let s = raw.get("shape");
            patch.insert("shape".into(), if is_shape(s) { s.cloned().unwrap_or(Value::Null) } else { Value::Null });
            out = apply_bubble_patch(Some(&out), &id, &Value::Object(patch));
        }
        Value::Object(out)
    } else {
        prev["camBubbleSlots"].clone()
    };
    let flag = |k: &str| next[k].as_bool().map_or_else(|| prev[k].clone(), Value::Bool);
    let mut out = Map::new();
    out.insert("camBubbles".into(), flag("camBubbles"));
    out.insert("camBubblesAllScenes".into(), flag("camBubblesAllScenes"));
    out.insert("camBubbleCorner".into(), corner);
    out.insert("camBubbleSize".into(), json!(js::round(size)));
    out.insert("camBubbleShape".into(), shape);
    out.insert("camBubbleSlots".into(), slots);
    Value::Object(out)
}
