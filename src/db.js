import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS students (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    grade INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mastery (
    student_id INTEGER NOT NULL REFERENCES students(id),
    skill_id   TEXT NOT NULL,
    score      REAL NOT NULL DEFAULT 0,
    attempts   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (student_id, skill_id)
  );
  CREATE TABLE IF NOT EXISTS progress (
    student_id   INTEGER NOT NULL REFERENCES students(id),
    activity_id  TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (student_id, activity_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    started_at TEXT NOT NULL,
    ended_at   TEXT
  );
  CREATE TABLE IF NOT EXISTS heartbeats (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER NOT NULL REFERENCES sessions(id),
    active_seconds REAL NOT NULL,
    idle_seconds   REAL NOT NULL,
    at             TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES students(id),
    session_id  INTEGER NOT NULL REFERENCES sessions(id),
    activity_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    choice      INTEGER NOT NULL,
    correct     INTEGER NOT NULL,
    at          TEXT NOT NULL
  );
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
