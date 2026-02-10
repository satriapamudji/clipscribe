const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
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
      UNIQUE(session_id, chunk_index),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
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
  `);

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
