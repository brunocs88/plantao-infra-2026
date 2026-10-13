import dgram from 'node:dgram';
import { config } from './config.js';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Reduz a nome de domínio. Nunca guarda caminho, query string ou conteúdo. */
export function cleanDomain(raw) {
  let d = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '');
  d = d.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  return DOMAIN_RE.test(d) ? d : null;
}

/** Interpreta linhas de dnsmasq ("query[A] x.com from 10.0.0.5") e squid (access.log nativo). */
export function parseLogLine(line) {
  let m = /query\[(\w+)\]\s+(\S+)\s+from\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(line);
  if (m) {
    const domain = cleanDomain(m[2]);
    return domain ? { ts: new Date().toISOString(), client_ip: m[3], domain, qtype: m[1], source: 'dnsmasq' } : null;
  }
  m = /^(\d+(?:\.\d+)?)\s+\d+\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\S+\s+\d+\s+\S+\s+(\S+)/.exec(line.replace(/^<\d+>.*?:\s/, ''));
  if (m) {
    const domain = cleanDomain(m[3]);
    return domain ? { ts: new Date(Number(m[1]) * 1000).toISOString(), client_ip: m[2], domain, qtype: null, source: 'squid' } : null;
  }
  return null;
}

/** Grava evento de navegação (somente domínio), vinculando-o à sessão ativa do IP naquele instante. */
export function storeNav(db, ev) {
  if (config.navLogging !== 'domain') return false;
  const domain = cleanDomain(ev.domain);
  if (!domain || !IPV4_RE.test(ev.client_ip || '')) return false;
  const ts = ev.ts && !Number.isNaN(Date.parse(ev.ts)) ? new Date(ev.ts).toISOString() : new Date().toISOString();
  const s = db.prepare(
    `SELECT id, user_id FROM sessions WHERE ip = ? AND started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
     ORDER BY started_at DESC LIMIT 1`,
  ).get(ev.client_ip, ts, ts);
  if (!s) return false; // tráfego sem sessão identificada (ex.: portal, infraestrutura) não é gravado
  db.prepare('INSERT INTO nav_log (ts, client_ip, session_id, user_id, domain, qtype, source) VALUES (?,?,?,?,?,?,?)')
    .run(ts, ev.client_ip, s.id, s.user_id, domain, ev.qtype || null, ev.source || 'api');
  return true;
}

export function startSyslog(db) {
  if (!config.syslogPort || config.navLogging !== 'domain') return null;
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg) => {
    for (const line of msg.toString('utf8').split('\n')) {
      const ev = line && parseLogLine(line);
      if (ev) storeNav(db, ev);
    }
  });
  sock.bind(config.syslogPort, () => console.log(`syslog UDP em :${config.syslogPort}`));
  return sock;
}
