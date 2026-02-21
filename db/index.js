const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'japanese_trainer.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
    runMigrations();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vocabulary_status (
      vid INTEGER PRIMARY KEY,
      spelling TEXT,
      reading TEXT,
      jpdb_tier TEXT,
      production_status TEXT DEFAULT 'never_attempted',
      times_drilled INTEGER DEFAULT 0,
      times_correct INTEGER DEFAULT 0,
      times_produced_in_conversation INTEGER DEFAULT 0,
      last_drilled DATETIME,
      last_produced DATETIME,
      life_domains TEXT
    );

    CREATE TABLE IF NOT EXISTS grammar_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grammar_point TEXT,
      pattern_name TEXT,
      bunpro_level TEXT,
      bunpro_accuracy REAL,
      n_level TEXT,
      production_status TEXT DEFAULT 'never_attempted',
      times_drilled INTEGER DEFAULT 0,
      times_correct INTEGER DEFAULT 0,
      times_produced_in_conversation INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      last_drilled DATETIME,
      last_produced DATETIME
    );

    CREATE TABLE IF NOT EXISTS drill_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      mode TEXT,
      english_prompt TEXT,
      target_japanese TEXT,
      user_response TEXT,
      is_correct BOOLEAN,
      vocabulary_used TEXT,
      grammar_used TEXT,
      errors TEXT,
      life_domain TEXT,
      difficulty_tier INTEGER,
      response_time_seconds REAL,
      follow_up_qa TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      source TEXT,
      raw_transcript TEXT,
      duration_minutes REAL,
      vocabulary_used TEXT,
      vocabulary_missed TEXT,
      grammar_produced TEXT,
      grammar_errors TEXT,
      english_switches TEXT,
      corrections_received TEXT,
      new_productions TEXT,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      date DATE PRIMARY KEY,
      drills_completed INTEGER DEFAULT 0,
      drills_correct INTEGER DEFAULT 0,
      accuracy_rate REAL,
      voice_drills INTEGER DEFAULT 0,
      typed_drills INTEGER DEFAULT 0,
      transcripts_analyzed INTEGER DEFAULT 0,
      new_words_produced INTEGER DEFAULT 0,
      new_patterns_produced INTEGER DEFAULT 0,
      minutes_practiced REAL DEFAULT 0,
      streak_day BOOLEAN DEFAULT FALSE
    );
  `);
}

function runMigrations() {
  // Add follow_up_qa column if missing (for existing databases)
  const cols = db.prepare("PRAGMA table_info(drill_results)").all();
  if (!cols.find(c => c.name === 'follow_up_qa')) {
    db.exec('ALTER TABLE drill_results ADD COLUMN follow_up_qa TEXT');
  }
}

module.exports = { getDb };
