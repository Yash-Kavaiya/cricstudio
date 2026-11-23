//! The JavaScript semantics the original relies on: number formatting, coercion and whitespace.

use std::io;
use std::sync::OnceLock;

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use regex::Regex;
use serde::Serialize;
use serde_json::ser::{Formatter, Serializer};
use serde_json::Value;

/// `\s` and `String.prototype.trim` whitespace in JavaScript (differs from Unicode White_Space).
pub const JS_WS: &str = r"[\t\n\x0B\x0C\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]";

pub fn is_js_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_ws)
}

/// Collapse every run of JavaScript whitespace to one space.
pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if is_js_ws(c) {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

/// `String(n)` for a number.
pub fn num_str(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    if n == 0.0 {
        return "0".into();
    }
    let abs = n.abs();
    if !(1e-6..1e21).contains(&abs) {
        let s = format!("{n:e}");
        return match s.split_once('e') {
            Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
            _ => s,
        };
    }
    format!("{n}")
}

/// `Number.prototype.toFixed`: rounds the exact binary value, ties away from zero.
pub fn to_fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() {
        return num_str(x);
    }
    let exact = format!("{:.1074}", x.abs());
    let (int, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut all: Vec<u8> = int.bytes().chain(frac.bytes().take(digits)).collect();
    if frac.as_bytes().get(digits).is_some_and(|d| *d >= b'5') {
        let mut i = all.len();
        loop {
            if i == 0 {
                all.insert(0, b'1');
                break;
            }
            i -= 1;
            if all[i] == b'9' {
                all[i] = b'0';
            } else {
                all[i] += 1;
                break;
            }
        }
    }
    let split = all.len() - digits;
    let text = String::from_utf8_lossy(&all);
    let sign = if x < 0.0 { "-" } else { "" };
    if digits == 0 {
        format!("{sign}{text}")
    } else {
        format!("{sign}{}.{}", &text[..split], &text[split..])
    }
}

/// `Math.round`: nearest integer, ties toward positive infinity.
pub fn round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `String(v)`.
pub fn to_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => num_str(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| if x.is_null() { String::new() } else { to_string(x) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `parseFloat(s)`.
pub fn parse_float(s: &str) -> f64 {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[+-]?(?:Infinity|[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)").expect("static regex"));
    let t = s.trim_start_matches(is_js_ws);
    let Some(m) = re.find(t) else { return f64::NAN };
    let m = m.as_str();
    if let Some(rest) = m.strip_prefix('-') {
        if rest == "Infinity" {
            return f64::NEG_INFINITY;
        }
    }
    if m.trim_start_matches('+') == "Infinity" {
        return f64::INFINITY;
    }
    m.parse().unwrap_or(f64::NAN)
}

/// `Number(v)`; `None` is `undefined`.
pub fn to_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_to_number(s),
        Some(a @ Value::Array(_)) => string_to_number(&to_string(a)),
        Some(Value::Object(_)) => f64::NAN,
    }
}

fn string_to_number(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(d) = t.strip_prefix(prefix) {
            return u64::from_str_radix(d, radix).map_or(f64::NAN, |n| n as f64);
        }
    }
    let p = parse_float(t);
    let body = t.trim_start_matches(['+', '-']);
    let valid = body == "Infinity" || (body.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-')) && t.parse::<f64>().is_ok());
    if valid {
        p
    } else {
        f64::NAN
    }
}

/// The original's `num(v, d)` helper.
pub fn num_or(v: &Value, d: f64) -> f64 {
    let n = match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Null => f64::NAN,
        other => parse_float(&to_string(other)),
    };
    if n.is_finite() {
        n
    } else {
        d
    }
}

pub fn num(v: &Value) -> f64 {
    num_or(v, 0.0)
}

/// The original's `str(v, d)` helper.
pub fn str_or(v: &Value, d: &str) -> String {
    if v.is_null() {
        d.to_string()
    } else {
        to_string(v)
    }
}

pub fn str_of(v: &Value) -> String {
    str_or(v, "")
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `a ?? b ?? ...`
pub fn first<'a>(vals: &[&'a Value]) -> &'a Value {
    static NULL: Value = Value::Null;
    vals.iter().find(|v| !v.is_null()).copied().unwrap_or(&NULL)
}

/// `Date.parse` for the ISO-8601 shapes ESPN sends; NaN otherwise.
pub fn date_parse(s: &str) -> f64 {
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return d.timestamp_millis() as f64;
    }
    for f in ["%Y-%m-%dT%H:%MZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%.fZ"] {
        if let Ok(d) = NaiveDateTime::parse_from_str(s, f) {
            return d.and_utc().timestamp_millis() as f64;
        }
    }
    f64::NAN
}

pub fn now_ms() -> f64 {
    Utc::now().timestamp_millis() as f64
}

/// `new Date().toISOString()`
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Writes numbers the way `JSON.stringify` does (`8`, not `8.0`).
#[derive(Clone, Copy, Default)]
pub struct JsFormatter;

impl Formatter for JsFormatter {
    fn write_f64<W: ?Sized + io::Write>(&mut self, w: &mut W, v: f64) -> io::Result<()> {
        w.write_all(num_str(v).as_bytes())
    }
    fn write_f32<W: ?Sized + io::Write>(&mut self, w: &mut W, v: f32) -> io::Result<()> {
        self.write_f64(w, f64::from(v))
    }
}

/// `JSON.stringify(value)`.
pub fn stringify<T: Serialize + ?Sized>(value: &T) -> Result<String, serde_json::Error> {
    let mut buf = Vec::with_capacity(256);
    let mut ser = Serializer::with_formatter(&mut buf, JsFormatter);
    value.serialize(&mut ser)?;
    // serde_json only ever writes valid UTF-8
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_print_like_js() {
        for (n, s) in [
            (8.0, "8"),
            (0.1, "0.1"),
            (-0.0, "0"),
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (123456.789, "123456.789"),
        ] {
            assert_eq!(num_str(n), s);
        }
    }

    #[test]
    fn to_fixed_rounds_ties_up() {
        assert_eq!(to_fixed(2.125, 2), "2.13");
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(9.999, 1), "10.0");
        assert_eq!(to_fixed(42.5, 3), "42.500");
    }

    #[test]
    fn coercion_matches_js() {
        assert_eq!(parse_float("12abc"), 12.0);
        assert!(parse_float("abc").is_nan());
        assert_eq!(to_number(Some(&json!("12"))), 12.0);
        assert_eq!(to_number(Some(&json!(""))), 0.0);
        assert!(to_number(Some(&json!("12abc"))).is_nan());
        assert!(to_number(None).is_nan());
        assert_eq!(to_number(Some(&Value::Null)), 0.0);
    }
}
