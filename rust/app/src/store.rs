//! SQLite store using the original schema, so an existing `data/cricstudio.db` opens as-is.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection, OptionalExtension, Row};

#[derive(Clone, Debug)]
pub struct StudioRecord {
    pub id: String,
    pub name: String,
    pub match_key: Option<String>,
    pub host_token_hash: String,
    pub guest_token_hash: String,
    pub program_token_hash: String,
    pub guest_token_enc: String,
    pub settings: String,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct DestinationRecord {
    pub id: String,
    pub studio_id: String,
    pub platform: String,
    pub name: String,
    pub url: String,
    pub key_enc: String,
    pub enabled: bool,
    pub created_at: i64,
}

#[derive(Default)]
pub struct DestinationPatch {
    pub name: Option<String>,
    pub url: Option<String>,
    pub key_enc: Option<String>,
    pub enabled: Option<bool>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  match_key TEXT,
  host_token_hash TEXT NOT NULL,
  guest_token_hash TEXT NOT NULL,
  program_token_hash TEXT NOT NULL,
  guest_token_enc TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS destinations_studio ON destinations(studio_id);
";

fn wants_live(settings: &str) -> i64 {
    i64::from(settings.contains("\"wantLive\":true"))
}

fn studio_from_row(r: &Row<'_>) -> rusqlite::Result<StudioRecord> {
    Ok(StudioRecord {
        id: r.get("id")?,
        name: r.get("name")?,
        match_key: r.get("match_key")?,
        host_token_hash: r.get("host_token_hash")?,
        guest_token_hash: r.get("guest_token_hash")?,
        program_token_hash: r.get("program_token_hash")?,
        guest_token_enc: r.get("guest_token_enc")?,
        settings: r.get::<_, Option<String>>("settings")?.unwrap_or_else(|| "{}".into()),
        created_at: r.get("created_at")?,
    })
}

fn dest_from_row(r: &Row<'_>) -> rusqlite::Result<DestinationRecord> {
    Ok(DestinationRecord {
        id: r.get("id")?,
        studio_id: r.get("studio_id")?,
        platform: r.get("platform")?,
        name: r.get("name")?,
        url: r.get("url")?,
        key_enc: r.get("key_enc")?,
        enabled: r.get::<_, i64>("enabled")? != 0,
        created_at: r.get("created_at")?,
    })
}

pub struct Repo {
    db: Mutex<Connection>,
}

impl Repo {
    pub fn open(file: &Path) -> anyhow::Result<Self> {
        let db = Connection::open(file)?;
        db.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;")?;
        db.execute_batch(SCHEMA)?;
        let has_flag = {
            let mut st = db.prepare("PRAGMA table_info(studios)")?;
            let names = st.query_map([], |r| r.get::<_, String>("name"))?.collect::<Result<Vec<_>, _>>()?;
            names.iter().any(|n| n == "want_live")
        };
        if !has_flag {
            db.execute_batch("ALTER TABLE studios ADD COLUMN want_live INTEGER NOT NULL DEFAULT 0; UPDATE studios SET want_live = 1 WHERE settings LIKE '%\"wantLive\":true%';")?;
        }
        db.execute_batch("CREATE INDEX IF NOT EXISTS studios_want_live ON studios(want_live) WHERE want_live = 1")?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn create_studio(&self, s: &StudioRecord) -> anyhow::Result<()> {
        self.conn().prepare_cached(
            "INSERT INTO studios (id,name,match_key,host_token_hash,guest_token_hash,program_token_hash,guest_token_enc,settings,created_at,want_live) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )?
        .execute(params![s.id, s.name, s.match_key, s.host_token_hash, s.guest_token_hash, s.program_token_hash, s.guest_token_enc, s.settings, s.created_at, wants_live(&s.settings)])?;
        Ok(())
    }

    pub fn get_studio(&self, id: &str) -> anyhow::Result<Option<StudioRecord>> {
        Ok(self
            .conn()
            .prepare_cached("SELECT * FROM studios WHERE id = ?")?
            .query_row([id], studio_from_row)
            .optional()?)
    }

    pub fn list_live_studios(&self) -> anyhow::Result<Vec<String>> {
        let db = self.conn();
        let mut st = db.prepare_cached("SELECT id FROM studios WHERE want_live = 1")?;
        let ids = st.query_map([], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn set_match_key(&self, id: &str, key: Option<&str>) -> anyhow::Result<()> {
        self.conn()
            .prepare_cached("UPDATE studios SET match_key=? WHERE id=?")?
            .execute(params![key, id])?;
        Ok(())
    }

    pub fn save_settings(&self, id: &str, settings: &str, name: &str) -> anyhow::Result<()> {
        self.conn()
            .prepare_cached("UPDATE studios SET name=?, settings=?, want_live=? WHERE id=?")?
            .execute(params![name, settings, wants_live(settings), id])?;
        Ok(())
    }

    pub fn list_destinations(&self, studio_id: &str) -> anyhow::Result<Vec<DestinationRecord>> {
        let db = self.conn();
        let mut st = db.prepare_cached("SELECT * FROM destinations WHERE studio_id = ? ORDER BY created_at")?;
        let rows = st.query_map([studio_id], dest_from_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn add_destination(&self, d: &DestinationRecord) -> anyhow::Result<()> {
        self.conn()
            .prepare_cached("INSERT INTO destinations (id,studio_id,platform,name,url,key_enc,enabled,created_at) VALUES (?,?,?,?,?,?,?,?)")?
            .execute(params![
                d.id,
                d.studio_id,
                d.platform,
                d.name,
                d.url,
                d.key_enc,
                i64::from(d.enabled),
                d.created_at
            ])?;
        Ok(())
    }

    pub fn update_destination(&self, id: &str, studio_id: &str, p: DestinationPatch) -> anyhow::Result<()> {
        let db = self.conn();
        if let Some(v) = p.name {
            db.execute("UPDATE destinations SET name=? WHERE id=? AND studio_id=?", params![v, id, studio_id])?;
        }
        if let Some(v) = p.url {
            db.execute("UPDATE destinations SET url=? WHERE id=? AND studio_id=?", params![v, id, studio_id])?;
        }
        if let Some(v) = p.key_enc {
            db.execute("UPDATE destinations SET key_enc=? WHERE id=? AND studio_id=?", params![v, id, studio_id])?;
        }
        if let Some(v) = p.enabled {
            db.execute(
                "UPDATE destinations SET enabled=? WHERE id=? AND studio_id=?",
                params![i64::from(v), id, studio_id],
            )?;
        }
        Ok(())
    }

    pub fn delete_destination(&self, id: &str, studio_id: &str) -> anyhow::Result<()> {
        self.conn()
            .prepare_cached("DELETE FROM destinations WHERE id = ? AND studio_id = ?")?
            .execute(params![id, studio_id])?;
        Ok(())
    }
}
