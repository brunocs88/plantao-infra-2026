import { config } from './config.js';

const range = (q) => ({
  from: q.from ? new Date(q.from).toISOString() : new Date(Date.now() - 30 * 86400_000).toISOString(),
  to: q.to ? new Date(q.to).toISOString() : new Date().toISOString(),
});

export function summary(db, q = {}) {
  const { from, to } = range(q);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const sessions = one('SELECT COUNT(*) n, COUNT(DISTINCT user_id) u FROM sessions WHERE started_at BETWEEN ? AND ?', from, to);
  const newUsers = one('SELECT COUNT(*) n FROM users WHERE verified_at BETWEEN ? AND ?', from, to).n;
  const avg = one(
    `SELECT AVG((julianday(ended_at) - julianday(started_at)) * 1440) m FROM sessions
      WHERE ended_at IS NOT NULL AND started_at BETWEEN ? AND ?`, from, to).m;
  const marketing = one(
    `SELECT SUM(granted) g, COUNT(*) t FROM (
       SELECT granted FROM consents c WHERE kind='marketing' AND created_at BETWEEN ? AND ?)`, from, to);
  return {
    period: { from, to },
    sessions: sessions.n,
    uniqueUsers: sessions.u,
    newUsers,
    avgSessionMinutes: avg == null ? null : Math.round(avg * 10) / 10,
    marketingOptInRate: marketing.t ? Math.round((marketing.g / marketing.t) * 1000) / 10 : null,
    byDay: all(
      `SELECT substr(started_at,1,10) day, COUNT(*) sessions, COUNT(DISTINCT user_id) users
         FROM sessions WHERE started_at BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
    byHour: all(
      `SELECT substr(started_at,12,2) hour, COUNT(*) sessions
         FROM sessions WHERE started_at BETWEEN ? AND ? GROUP BY hour ORDER BY hour`, from, to),
    byAp: all(
      `SELECT COALESCE(ap,'(n/d)') ap, COUNT(*) sessions FROM sessions
        WHERE started_at BETWEEN ? AND ? GROUP BY ap ORDER BY sessions DESC LIMIT 20`, from, to),
    navigation: config.navLogging === 'domain'
      ? all(
        `SELECT domain, COUNT(*) hits, COUNT(DISTINCT user_id) users FROM nav_log
          WHERE ts BETWEEN ? AND ? GROUP BY domain ORDER BY hits DESC LIMIT 25`, from, to)
      : null,
  };
}

/** Relatórios tabulares para CSV. CPF sempre mascarado. */
export function tableReport(db, type, q = {}) {
  const { from, to } = range(q);
  if (type === 'sessions') {
    return {
      cols: ['session_id', 'started_at', 'ended_at', 'user_id', 'name', 'cpf', 'ip', 'mac', 'ap'],
      rows: db.prepare(
        `SELECT s.id session_id, s.started_at, s.ended_at, s.user_id, u.name, u.cpf_masked cpf, s.ip, s.mac, s.ap
           FROM sessions s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.started_at BETWEEN ? AND ? ORDER BY s.started_at`).all(from, to),
    };
  }
  if (type === 'nav' && config.navLogging === 'domain') {
    return {
      cols: ['ts', 'user_id', 'client_ip', 'domain', 'qtype', 'source'],
      rows: db.prepare('SELECT ts, user_id, client_ip, domain, qtype, source FROM nav_log WHERE ts BETWEEN ? AND ? ORDER BY ts')
        .all(from, to),
    };
  }
  if (type === 'consents') {
    return {
      cols: ['created_at', 'user_id', 'kind', 'granted', 'policy_version', 'text_sha256'],
      rows: db.prepare('SELECT created_at, user_id, kind, granted, policy_version, text_sha256 FROM consents WHERE created_at BETWEEN ? AND ? ORDER BY created_at')
        .all(from, to),
    };
  }
  return null;
}

/** Quem estava com o IP em dado instante (requisição judicial / incidente). Identidade completa. */
export function lookupByIp(db, ip, at) {
  const ts = new Date(at).toISOString();
  return db.prepare(
    `SELECT s.id session_id, s.started_at, s.ended_at, s.ip, s.mac, s.ap,
            u.id user_id, u.name, u.cpf_masked, u.email, u.phone
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.ip = ? AND s.started_at <= ? AND (s.ended_at IS NULL OR s.ended_at >= ?)
      ORDER BY s.started_at DESC`).all(ip, ts, ts);
}

/** Portabilidade/acesso do titular (LGPD art. 18, II e V). */
export function exportUserData(db, userId) {
  const q = (sql) => db.prepare(sql).all(userId);
  return {
    titular: db.prepare('SELECT id, name, cpf_masked, email, phone, verified_at, created_at FROM users WHERE id=?').get(userId),
    consentimentos: q('SELECT kind, granted, policy_version, created_at FROM consents WHERE user_id=? ORDER BY id'),
    sessoes: q('SELECT started_at, ended_at, ip, mac, ap FROM sessions WHERE user_id=? ORDER BY id'),
    navegacao: config.navLogging === 'domain' ? q('SELECT ts, domain FROM nav_log WHERE user_id=? ORDER BY ts') : [],
    solicitacoes: q('SELECT kind, status, created_at, done_at FROM dsr WHERE user_id=? ORDER BY id'),
  };
}
