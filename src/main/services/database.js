const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function legacyTrackIdForSession(sessionId) {
  return `legacy:${String(sessionId || "").trim()}`;
}

function ensureSessionTracksTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_tracks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      track_order INTEGER NOT NULL,
      source_label TEXT NOT NULL,
      source_format TEXT NOT NULL,
      source_kind TEXT,
      source_input TEXT,
      source_device_id TEXT,
      source_process_id TEXT,
      source_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      started_at_sec REAL NOT NULL DEFAULT 0,
      ended_at_sec REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, track_key),
      UNIQUE(session_id, track_order),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_tracks_session
    ON session_tracks(session_id, track_order);
  `);
}

function backfillLegacyTracks(db) {
  const sessionColumns = db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .map((col) => col.name);
  if (!sessionColumns.includes("id")) {
    return;
  }
  db.exec(`
    INSERT OR IGNORE INTO session_tracks (
      id, session_id, track_key, track_order,
      source_label, source_format, source_kind,
      source_input, source_device_id, source_process_id,
      source_json, status, error_message,
      started_at_sec, ended_at_sec, created_at, updated_at
    )
    SELECT
      'legacy:' || s.id AS id,
      s.id AS session_id,
      'legacy-mix' AS track_key,
      0 AS track_order,
      'Mixed Input' AS source_label,
      'mixed' AS source_format,
      'mixed' AS source_kind,
      NULL AS source_input,
      NULL AS source_device_id,
      NULL AS source_process_id,
      CASE
        WHEN s.selected_sources_json IS NULL OR trim(s.selected_sources_json) = '' THEN '[]'
        ELSE s.selected_sources_json
      END AS source_json,
      CASE
        WHEN s.status IN ('recording', 'paused', 'stopped', 'error') THEN s.status
        ELSE 'stopped'
      END AS status,
      NULL AS error_message,
      0 AS started_at_sec,
      CASE
        WHEN s.status IN ('stopped', 'error') THEN s.recorded_seconds
        ELSE NULL
      END AS ended_at_sec,
      s.created_at AS created_at,
      s.updated_at AS updated_at
    FROM sessions s
  `);
}

function ensureTranscriptChunksTrackAware(db) {
  const chunkColumns = db
    .prepare("PRAGMA table_info(transcript_chunks)")
    .all()
    .map((col) => col.name);
  if (chunkColumns.length === 0) {
    return;
  }
  if (chunkColumns.includes("track_id")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcript_chunks_session_track
      ON transcript_chunks(session_id, track_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_transcript_chunks_queue
      ON transcript_chunks(status, created_at);
    `);
    return;
  }

  const hasRetryCount = chunkColumns.includes("retry_count");
  const hasMetaJson = chunkColumns.includes("meta_json");
  if (!hasRetryCount) {
    db.exec("ALTER TABLE transcript_chunks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasMetaJson) {
    db.exec("ALTER TABLE transcript_chunks ADD COLUMN meta_json TEXT");
  }

  db.exec(`
    ALTER TABLE transcript_chunks RENAME TO transcript_chunks_legacy;

    CREATE TABLE transcript_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      text TEXT,
      meta_json TEXT,
      provider TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, track_id, chunk_index),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES session_tracks(id) ON DELETE CASCADE
    );

    INSERT INTO transcript_chunks (
      id, session_id, track_id, chunk_index, start_sec, end_sec,
      text, meta_json, provider, status, retry_count, error_message,
      file_path, created_at, updated_at
    )
    SELECT
      c.id,
      c.session_id,
      'legacy:' || c.session_id AS track_id,
      c.chunk_index,
      c.start_sec,
      c.end_sec,
      c.text,
      c.meta_json,
      c.provider,
      c.status,
      COALESCE(c.retry_count, 0),
      c.error_message,
      c.file_path,
      c.created_at,
      c.updated_at
    FROM transcript_chunks_legacy c;

    DROP TABLE transcript_chunks_legacy;

    CREATE INDEX IF NOT EXISTS idx_transcript_chunks_session_track
    ON transcript_chunks(session_id, track_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_transcript_chunks_queue
    ON transcript_chunks(status, created_at);
  `);
}

function initDatabase(dbPath) {
  ensureDirectory(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      chunk_seconds INTEGER NOT NULL,
      audio_master_path TEXT,
      summary_text TEXT,
      summary_brief_text TEXT,
      summary_model TEXT,
      summary_generated_at TEXT,
      session_dir TEXT NOT NULL,
      selected_sources_json TEXT NOT NULL,
      recorded_seconds REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS session_tracks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      track_order INTEGER NOT NULL,
      source_label TEXT NOT NULL,
      source_format TEXT NOT NULL,
      source_kind TEXT,
      source_input TEXT,
      source_device_id TEXT,
      source_process_id TEXT,
      source_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      started_at_sec REAL NOT NULL DEFAULT 0,
      ended_at_sec REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, track_key),
      UNIQUE(session_id, track_order),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      text TEXT,
      meta_json TEXT,
      provider TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, track_id, chunk_index),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES session_tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      at_sec REAL NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_chat_messages_session_created
    ON session_chat_messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_session_tracks_session
    ON session_tracks(session_id, track_order);
  `);

  ensureSessionTracksTable(db);
  backfillLegacyTracks(db);
  ensureTranscriptChunksTrackAware(db);

  const chunkColumns = db
    .prepare("PRAGMA table_info(transcript_chunks)")
    .all()
    .map((col) => col.name);
  if (!chunkColumns.includes("retry_count")) {
    db.exec("ALTER TABLE transcript_chunks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!chunkColumns.includes("meta_json")) {
    db.exec("ALTER TABLE transcript_chunks ADD COLUMN meta_json TEXT");
  }

  const sessionColumns = db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .map((col) => col.name);
  if (!sessionColumns.includes("summary_text")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_text TEXT");
  }
  if (!sessionColumns.includes("summary_brief_text")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_brief_text TEXT");
  }
  if (!sessionColumns.includes("summary_model")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_model TEXT");
  }
  if (!sessionColumns.includes("summary_generated_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_generated_at TEXT");
  }

  return db;
}

module.exports = {
  initDatabase
};
