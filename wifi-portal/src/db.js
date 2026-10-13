import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { hmac, nowIso } from './util.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT, cpf_hash TEXT UNIQUE, cpf_masked TEXT, email TEXT, phone TEXT,
  verified_at TEXT, created_at TEXT NOT NULL,
  erasure_requested_at TEXT, anonymized_at TEXT
);
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, code_hash TEXT NOT NULL,
  mac TEXT, ip TEXT, ap TEXT, expires_at TEXT NOT NULL, used_at TEXT, attempts INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
  granted INTEGER NOT NULL, policy_version TEXT NOT NULL, text_sha256 TEXT NOT NULL,
  ip TEXT, user_agent TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mac TEXT, ip TEXT, ap TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, bytes_in INTEGER, bytes_out INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions(ip, started_at);
-- Registro de conexão (Marco Civil art. 13) com encadeamento de hash (evidência de integridade)
CREATE TABLE IF NOT EXISTS conn_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, event TEXT NOT NULL,
  session_id INTEGER, user_id INTEGER, mac TEXT, ip TEXT, ap TEXT,
  nat_port_start INTEGER, nat_port_end INTEGER,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conn_ts ON conn_log(ts);
CREATE TABLE IF NOT EXISTS nav_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, client_ip TEXT NOT NULL,
  session_id INTEGER, user_id INTEGER, domain TEXT NOT NULL, qtype TEXT, source TEXT
);
CREATE INDEX IF NOT EXISTS idx_nav_ts ON nav_log(ts);
CREATE INDEX IF NOT EXISTS idx_nav_domain ON nav_log(domain);
CREATE TABLE IF NOT EXISTS dsr (
  id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, contact TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', created_at TEXT NOT NULL, done_at TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT
);
`;

export function openDb(path = config.dbPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function audit(db, actor, action, detail = '') {
  db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?,?,?,?)').run(
    nowIso(), actor, action, typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
}

const GENESIS = '0'.repeat(64);

/** Acrescenta evento ao registro de conexão encadeando o hash do anterior. */
export function appendConnLog(db, e) {
  const last = db.prepare('SELECT hash FROM conn_log ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : GENESIS;
  const row = {
    ts: e.ts || nowIso(), event: e.event, session_id: e.session_id ?? null, user_id: e.user_id ?? null,
    mac: e.mac ?? null, ip: e.ip ?? null, ap: e.ap ?? null,
    nat_port_start: e.nat_port_start ?? null, nat_port_end: e.nat_port_end ?? null,
  };
  const hash = hmac(prev + JSON.stringify(row));
  db.prepare(
    `INSERT INTO conn_log (ts,event,session_id,user_id,mac,ip,ap,nat_port_start,nat_port_end,prev_hash,hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(row.ts, row.event, row.session_id, row.user_id, row.mac, row.ip, row.ap,
    row.nat_port_start, row.nat_port_end, prev, hash);
}

export function verifyConnChain(db) {
  const rows = db.prepare('SELECT * FROM conn_log ORDER BY id').all();
  let prev = rows.length ? rows[0].prev_hash : GENESIS; // após expurgo, ancora no primeiro registro restante
  for (const r of rows) {
    const row = {
      ts: r.ts, event: r.event, session_id: r.session_id, user_id: r.user_id, mac: r.mac, ip: r.ip,
      ap: r.ap, nat_port_start: r.nat_port_start, nat_port_end: r.nat_port_end,
    };
    if (r.prev_hash !== prev || r.hash !== hmac(prev + JSON.stringify(row))) {
      return { ok: false, brokenAtId: r.id, checked: rows.length };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
