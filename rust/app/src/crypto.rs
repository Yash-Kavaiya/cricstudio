//! Stream-key encryption, wire-compatible with the original (scrypt key, AES-256-GCM,
//! `base64(iv[12] | tag[16] | ciphertext)`), so existing databases keep working.

use std::fs;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Context};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Clone)]
pub struct Crypto {
    cipher: Aes256Gcm,
}

impl Crypto {
    pub fn new(secret: &str, data_dir: &Path) -> anyhow::Result<Self> {
        let secret = if secret.is_empty() {
            load_or_create_secret(data_dir)?
        } else {
            secret.to_string()
        };
        // Node's scryptSync defaults: N=16384, r=8, p=1
        let params = scrypt::Params::new(14, 8, 1, 32).map_err(|e| anyhow!("scrypt params: {e}"))?;
        let mut key = [0u8; 32];
        scrypt::scrypt(secret.as_bytes(), b"cricstudio-stream-keys", &params, &mut key).map_err(|e| anyhow!("scrypt: {e}"))?;
        Ok(Self {
            cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)),
        })
    }

    pub fn encrypt(&self, plain: &str) -> anyhow::Result<String> {
        let mut iv = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut iv);
        let sealed = self
            .cipher
            .encrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: plain.as_bytes(),
                    aad: b"",
                },
            )
            .map_err(|_| anyhow!("encryption failed"))?;
        let (ct, tag) = sealed.split_at(sealed.len() - 16);
        let mut out = Vec::with_capacity(28 + ct.len());
        out.extend_from_slice(&iv);
        out.extend_from_slice(tag);
        out.extend_from_slice(ct);
        Ok(STANDARD.encode(out))
    }

    pub fn decrypt(&self, enc: &str) -> anyhow::Result<String> {
        let buf = STANDARD.decode(enc).context("bad ciphertext")?;
        if buf.len() < 28 {
            return Err(anyhow!("ciphertext too short"));
        }
        let mut sealed = buf[28..].to_vec();
        sealed.extend_from_slice(&buf[12..28]);
        let plain = self
            .cipher
            .decrypt(Nonce::from_slice(&buf[..12]), Payload { msg: &sealed, aad: b"" })
            .map_err(|_| anyhow!("Unsupported state or unable to authenticate data"))?;
        Ok(String::from_utf8(plain)?)
    }
}

fn load_or_create_secret(data_dir: &Path) -> anyhow::Result<String> {
    let f = data_dir.join("secret.key");
    if f.exists() {
        return Ok(fs::read_to_string(&f)?.trim().to_string());
    }
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let secret: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    fs::write(&f, &secret)?;
    restrict(&f);
    Ok(secret)
}

#[cfg(unix)]
fn restrict(f: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(f, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_: &Path) {}

pub fn new_token() -> String {
    let mut b = [0u8; 18];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

pub fn new_id() -> String {
    let mut b = [0u8; 6];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b).replace(['-', '_'], "x").to_lowercase()
}

pub fn hash_token(t: &str) -> String {
    Sha256::digest(t.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn token_matches(token: &str, hash: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let a = hash_token(token);
    a.len() == hash.len() && bool::from(a.as_bytes().ct_eq(hash.as_bytes()))
}

pub fn mask_key(k: &str) -> String {
    let units: Vec<u16> = k.encode_utf16().collect();
    if units.len() <= 6 {
        return "••••".into();
    }
    let head = String::from_utf16_lossy(&units[..3]);
    let tail = String::from_utf16_lossy(&units[units.len() - 3..]);
    format!("{head}••••••{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_masks() {
        let dir = std::env::temp_dir();
        let c = Crypto::new("test-secret", &dir).unwrap();
        let enc = c.encrypt("live_abc123xyz").unwrap();
        assert!(!enc.contains("abc123"));
        assert_eq!(c.decrypt(&enc).unwrap(), "live_abc123xyz");
        assert_eq!(mask_key("live_abc123xyz"), "liv••••••xyz");
        assert_eq!(mask_key("short"), "••••");
        assert!(token_matches("t0k", &hash_token("t0k")));
        assert!(!token_matches("nope", &hash_token("t0k")));
        assert!(!token_matches("", &hash_token("")));
    }

    /// Ciphertext produced by the original Node code with secret "test-secret".
    #[test]
    fn decrypts_values_written_by_the_node_server() {
        let c = Crypto::new("test-secret", &std::env::temp_dir()).unwrap();
        let from_node = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/node-ciphertext.txt")).unwrap();
        assert_eq!(c.decrypt(from_node.trim()).unwrap(), "live_key_from_node");
    }
}
