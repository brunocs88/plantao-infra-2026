import { config } from './config.js';
import { audit } from './db.js';
import { daysAgoIso, nowIso } from './util.js';

/** Expurgo por prazo de guarda. Roda na partida e a cada 6h. */
export function runRetention(db) {
  const nav = db.prepare('DELETE FROM nav_log WHERE ts < ?').run(daysAgoIso(config.navRetentionDays)).changes;
  const connCutoff = daysAgoIso(config.connRetentionDays);
  const conn = db.prepare('DELETE FROM conn_log WHERE ts < ?').run(connCutoff).changes;
  db.prepare('DELETE FROM otps WHERE expires_at < ?').run(daysAgoIso(1));

  // Titulares com pedido de eliminação: anonimiza quando não houver mais registro de conexão a guardar (LGPD art. 16, I).
  const pending = db.prepare(
    `SELECT id FROM users WHERE erasure_requested_at IS NOT NULL AND anonymized_at IS NULL
       AND id NOT IN (SELECT DISTINCT user_id FROM conn_log WHERE user_id IS NOT NULL)`,
  ).all();
  for (const u of pending) anonymizeUser(db, u.id);

  if (nav || conn || pending.length) audit(db, 'sistema', 'retencao', { nav, conn, anonimizados: pending.length });
  return { nav, conn, anonymized: pending.length };
}

export function anonymizeUser(db, id) {
  db.prepare(
    `UPDATE users SET name='ANONIMIZADO', cpf_hash=NULL, cpf_masked=NULL, email=NULL, phone=NULL, anonymized_at=? WHERE id=?`,
  ).run(nowIso(), id);
  db.prepare('UPDATE consents SET ip=NULL, user_agent=NULL WHERE user_id=?').run(id);
  db.prepare('UPDATE nav_log SET user_id=NULL WHERE user_id=?').run(id);
}
