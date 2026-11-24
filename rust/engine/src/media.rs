//! Pure helpers for the stream pipeline, speech and translation.

use std::sync::OnceLock;

use regex::Regex;

use crate::js;
use crate::types::MatchDetail;

/// Text safe to put in Edge TTS's unescaped SSML.
pub fn speakable(s: &str) -> String {
    static ENTITY: OnceLock<Regex> = OnceLock::new();
    static CB: OnceLock<Regex> = OnceLock::new();
    let entity = ENTITY.get_or_init(|| Regex::new("&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").expect("static regex"));
    let cb = CB.get_or_init(|| Regex::new(r"(?-u:\b)[cC] & [bB](?-u:\b)").expect("static regex"));
    let t = entity.replace_all(s, " ").replace(['†', '‡', '*'], "");
    let t = cb.replace_all(&t, "caught and bowled").replace('&', " and ").replace(['<', '>'], " ");
    js::trim(&js::collapse_ws(&t)).to_string()
}

/// `"hi-IN"` to `"hi"`; English needs no translation.
pub fn target_code(lang: Option<&str>) -> Option<String> {
    let code = lang.unwrap_or("en-IN").split('-').next().unwrap_or("").to_lowercase();
    (!code.is_empty() && code != "en").then_some(code)
}

pub fn rtmp_url(url: &str, key: &str) -> String {
    if key.is_empty() {
        url.to_string()
    } else if url.ends_with('/') {
        format!("{url}{key}")
    } else {
        format!("{url}/{key}")
    }
}

/// Only constant-rate H.264 in fragmented MP4 can be copied without re-encoding.
pub fn prefer_video_copy(mime: &str) -> bool {
    let m = mime.to_ascii_lowercase();
    m.contains("mp4") && (m.contains("h264") || m.contains("avc1"))
}

/// Browser WebM/fMP4 to H.264/AAC MPEG-TS on stdout, with timestamps continuing across restarts.
pub fn encoder_args(ts_offset: f64, video_kbps: f64, audio_kbps: f64, preset: &str, video_copy: bool) -> Vec<String> {
    let v = js::num_str(video_kbps);
    let mut args: Vec<String> = strings(&[
        "-hide_banner",
        "-loglevel",
        "info",
        "-fflags",
        "+genpts+discardcorrupt",
        "-thread_queue_size",
        "1024",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ]);
    if video_copy {
        args.extend(strings(&["-fps_mode", "passthrough", "-c:v", "copy", "-bsf:v", "h264_mp4toannexb"]));
    } else {
        args.extend(strings(&[
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-tune",
            "zerolatency",
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
            "-x264-params",
            "repeat-headers=1:force-cfr=1",
            "-vf",
            "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
            "-r",
            "30",
            "-fps_mode",
            "cfr",
            "-g",
            "60",
            "-keyint_min",
            "60",
            "-sc_threshold",
            "0",
        ]));
        args.extend([
            "-b:v".into(),
            format!("{v}k"),
            "-maxrate".into(),
            format!("{v}k"),
            "-bufsize".into(),
            format!("{}k", js::num_str(video_kbps * 2.0)),
        ]);
    }
    args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), format!("{}k", js::num_str(audio_kbps))]);
    args.extend(strings(&["-ar", "44100", "-ac", "2", "-output_ts_offset"]));
    args.push(js::to_fixed(ts_offset, 3));
    args.extend(strings(&["-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1"]));
    args
}

/// Copy the TS feed to one RTMP ingest; can rejoin mid-stream at the next keyframe.
pub fn relay_args(url: &str) -> Vec<String> {
    let mut args = strings(&[
        "-hide_banner",
        "-loglevel",
        "info",
        "-fflags",
        "+genpts+discardcorrupt",
        "-f",
        "mpegts",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-fps_mode",
        "passthrough",
        "-bsf:a",
        "aac_adtstoasc",
        "-avoid_negative_ts",
        "make_zero",
        "-flvflags",
        "no_duration_filesize",
        "-rtmp_live",
        "live",
        "-f",
        "flv",
    ]);
    args.push(url.to_string());
    args
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_string()).collect()
}

const CRICKET_TERMS: [&str; 44] = [
    "wicket",
    "boundary",
    "four",
    "six",
    "LBW",
    "leg before",
    "caught",
    "bowled",
    "stumped",
    "run out",
    "no ball",
    "wide",
    "leg bye",
    "maiden",
    "over",
    "powerplay",
    "yorker",
    "bouncer",
    "googly",
    "doosra",
    "cover drive",
    "pull shot",
    "sweep",
    "reverse sweep",
    "slip",
    "gully",
    "mid-wicket",
    "third man",
    "fine leg",
    "square leg",
    "mid-on",
    "mid-off",
    "run rate",
    "required rate",
    "DRS",
    "umpire",
    "innings",
    "century",
    "fifty",
    "hat-trick",
    "free hit",
    "death overs",
    "",
    "",
];

/// Vocabulary hints for speech-to-text: names in the match, then cricket terms.
pub fn cricket_hints(m: Option<&MatchDetail>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut add = |s: &str| {
        if !s.is_empty() && !names.iter().any(|n| n == s) {
            names.push(s.to_string());
        }
    };
    if let Some(m) = m {
        for t in &m.teams {
            add(&t.name);
            add(&t.abbr);
        }
        for inn in &m.innings {
            for b in &inn.batting {
                add(&b.name);
            }
            for b in &inn.bowling {
                add(&b.name);
            }
        }
    }
    names.extend(CRICKET_TERMS.iter().filter(|t| !t.is_empty()).map(|t| (*t).to_string()));
    names
}

/// A valid 16 kHz mono WAV of silence, used by "Test key".
pub fn silent_wav(seconds: f64) -> Vec<u8> {
    let n = js::round(16000.0 * seconds) as u32;
    let bytes = n * 2;
    let mut b = Vec::with_capacity(44 + bytes as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + bytes).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&16000u32.to_le_bytes());
    b.extend_from_slice(&32000u32.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&bytes.to_le_bytes());
    b.resize(44 + bytes as usize, 0);
    b
}
