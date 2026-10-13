import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb, audit, appendConnLog, verifyConnChain } from './db.js';
import { authorizeClient, notifyOtp } from './gateway.js';
import { storeNav, startSyslog } from './ingest.js';
import { runRetention } from './retention.js';
import { summary, tableReport, lookupByIp, exportUserData } from './reports.js';
import { anonymizeUser } from './retention.js';
import * as v from './views.js';
import { esc, hmac, onlyDigits, validCpf, maskCpf, validEmail, validMac, normMac, newOtp, nowIso, safeEqual, toCsv } from './util.js';

const MAX_BODY = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('corpo grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const parseForm = (s) => Object.fromEntries(new URLSearchParams(s));

const send = (res, status, body, type = 'text/html; charset=utf-8', extra = {}) => {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    ...extra,
  });
  res.end(body);
};
const json = (res, status, obj) => send(res, status, JSON.stringify(obj, null, 2), 'application/json; charset=utf-8');

export function createApp(db) {
  const hits = new Map(); // limite simples por IP
  const limited = (ip) => {
    const k = `${ip}:${Math.floor(Date.now() / 60000)}`;
    const n = (hits.get(k) || 0) + 1; hits.set(k, n);
    if (hits.size > 5000) hits.clear();
    return n > 20;
  };
  const clientIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const bearer = (req) => safeEqual((req.headers.authorization || '').replace(/^Bearer /, ''), config.ingestToken) && !!config.ingestToken;

  function adminAuth(req, res) {
    const [u, p] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(/:(.*)/s);
    if (u != null && safeEqual(u, config.adminUser) && safeEqual(p ?? '', config.adminPassword)) return true;
    send(res, 401, 'Autenticação necessária', 'text/plain; charset=utf-8', { 'www-authenticate': 'Basic realm="admin"' });
    return false;
  }

  const paramsOf = (src) => ({ mac: src.mac || '', ip: src.ip || '', ap: src.ap || '', url: src.url || '' });

  function recordConsents(userId, form, req) {
    const ins = db.prepare(
      'INSERT INTO consents (user_id,kind,granted,policy_version,text_sha256,ip,user_agent,created_at) VALUES (?,?,?,?,?,?,?,?)');
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    for (const kind of ['terms', 'privacy', 'marketing']) {
      ins.run(userId, kind, form[kind] ? 1 : 0, config.policyVersion, v.consentHash(kind), clientIp(req), ua, nowIso());
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    const method = req.method;

    if (method === 'GET' && path === '/healthz') return json(res, 200, { ok: true });
    // sondas de detecção de captive portal (Android/iOS/Windows) caem no portal
    if (method === 'GET' && ['/', '/portal', '/generate_204', '/hotspot-detect.html', '/connecttest.txt'].includes(path)) {
      return send(res, 200, v.portalPage({ params: paramsOf(q) }));
    }
    if (method === 'GET' && path === '/privacy') return send(res, 200, v.privacyPage());
    if (method === 'GET' && path === '/terms') return send(res, 200, v.termsPage());
    if (method === 'GET' && path === '/titular') return send(res, 200, v.titularPage());

    if (method === 'POST' && path === '/register') {
      if (limited(clientIp(req))) return send(res, 429, 'Muitas tentativas', 'text/plain');
      const f = parseForm(await readBody(req));
      const params = paramsOf(f);
      const fail = (error) => send(res, 400, v.portalPage({ params, error, values: f }));
      const name = String(f.name || '').trim().slice(0, 120);
      if (name.length < 5 || !name.includes(' ')) return fail('Informe o nome completo.');
      if (!validCpf(f.cpf)) return fail('CPF inválido.');
      if (!validEmail(f.email)) return fail('E-mail inválido.');
      if (!f.terms || !f.privacy) return fail('É necessário aceitar os Termos e a Política de Privacidade.');
      const phone = onlyDigits(f.phone).slice(0, 13) || null;
      const cpfHash = hmac(onlyDigits(f.cpf));
      let user = db.prepare('SELECT * FROM users WHERE cpf_hash=?').get(cpfHash);
      if (user) {
        db.prepare('UPDATE users SET name=?, email=?, phone=?, erasure_requested_at=NULL WHERE id=?').run(name, f.email.toLowerCase(), phone, user.id);
      } else {
        const r = db.prepare('INSERT INTO users (name,cpf_hash,cpf_masked,email,phone,created_at) VALUES (?,?,?,?,?,?)')
          .run(name, cpfHash, maskCpf(f.cpf), f.email.toLowerCase(), phone, nowIso());
        user = { id: Number(r.lastInsertRowid) };
      }
      recordConsents(user.id, f, req);
      const code = newOtp();
      db.prepare('INSERT INTO otps (user_id,code_hash,expires_at) VALUES (?,?,?)')
        .run(user.id, hmac(`${user.id}:${code}`), new Date(Date.now() + config.otpTtlMinutes * 60000).toISOString());
      await notifyOtp({ email: f.email, phone }, code);
      return send(res, 200, v.otpPage({ userId: user.id, params }));
    }

    if (method === 'POST' && path === '/verify') {
      if (limited(clientIp(req))) return send(res, 429, 'Muitas tentativas', 'text/plain');
      const f = parseForm(await readBody(req));
      const params = paramsOf(f);
      const uid = Number(f.uid);
      const otp = db.prepare('SELECT * FROM otps WHERE user_id=? AND used_at IS NULL ORDER BY id DESC LIMIT 1').get(uid);
      const bad = (error) => send(res, 400, v.otpPage({ userId: uid, params, error }));
      if (!otp || otp.expires_at < nowIso() || otp.attempts >= 5) return bad('Código expirado. Volte e solicite outro.');
      db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id=?').run(otp.id);
      if (!safeEqual(otp.code_hash, hmac(`${uid}:${String(f.code || '').trim()}`))) return bad('Código incorreto.');
      db.prepare('UPDATE otps SET used_at=? WHERE id=?').run(nowIso(), otp.id);
      db.prepare('UPDATE users SET verified_at=COALESCE(verified_at,?) WHERE id=?').run(nowIso(), uid);

      const ip = config.trustGatewayParams && params.ip ? params.ip : clientIp(req);
      const mac = validMac(params.mac) ? normMac(params.mac) : null;
      const ts = nowIso();
      const s = db.prepare('INSERT INTO sessions (user_id,mac,ip,ap,started_at) VALUES (?,?,?,?,?)')
        .run(uid, mac, ip, params.ap.slice(0, 64) || null, ts);
      const sid = Number(s.lastInsertRowid);
      appendConnLog(db, { ts, event: 'login', session_id: sid, user_id: uid, mac, ip, ap: params.ap.slice(0, 64) || null });
      try {
        await authorizeClient({ mac, ip, ap: params.ap, sessionId: sid, seconds: config.sessionHours * 3600 });
      } catch (e) {
        console.error('gateway:', e.message);
        return send(res, 502, v.page('Erro', '<h1>Não foi possível liberar o acesso. Tente novamente.</h1>'));
      }
      return send(res, 200, v.connectedPage(/^https?:\/\//.test(params.url) ? params.url : ''));
    }

    if (method === 'POST' && path === '/titular') {
      if (limited(clientIp(req))) return send(res, 429, 'Muitas tentativas', 'text/plain');
      const f = parseForm(await readBody(req));
      if (!validEmail(f.email) || !['acesso', 'correcao', 'eliminacao', 'revogar_marketing'].includes(f.kind)) {
        return send(res, 400, v.titularPage({ error: 'Dados inválidos.' }));
      }
      const u = db.prepare('SELECT id FROM users WHERE email=? AND anonymized_at IS NULL').get(f.email.toLowerCase());
      db.prepare('INSERT INTO dsr (user_id,kind,contact,created_at) VALUES (?,?,?,?)').run(u ? u.id : null, f.kind, f.email.toLowerCase(), nowIso());
      // resposta idêntica exista ou não o cadastro (evita enumeração)
      return send(res, 200, v.titularPage({ msg: 'Solicitação registrada. O encarregado entrará em contato pelo e-mail informado em até 15 dias.' }));
    }

    // ----- integrações (token) -----
    if (method === 'POST' && path === '/api/nav') {
      if (!bearer(req)) return json(res, 401, { error: 'token' });
      let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'json' }); }
      const list = Array.isArray(body) ? body.slice(0, 1000) : [body];
      return json(res, 200, { stored: list.filter((e) => storeNav(db, e)).length });
    }
    if (method === 'POST' && path === '/api/session/end') {
      if (!bearer(req)) return json(res, 401, { error: 'token' });
      let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'json' }); }
      const open = db.prepare('SELECT * FROM sessions WHERE ip=? AND ended_at IS NULL').all(String(b.ip || ''));
      const ts = nowIso();
      for (const s of open) {
        db.prepare('UPDATE sessions SET ended_at=?, bytes_in=?, bytes_out=? WHERE id=?').run(ts, b.bytes_in ?? null, b.bytes_out ?? null, s.id);
        appendConnLog(db, { ts, event: 'logout', session_id: s.id, user_id: s.user_id, mac: s.mac, ip: s.ip, ap: s.ap,
          nat_port_start: b.nat_port_start, nat_port_end: b.nat_port_end });
      }
      return json(res, 200, { ended: open.length });
    }

    // ----- administração -----
    if (path.startsWith('/admin')) {
      if (!adminAuth(req, res)) return;
      const adminCsp = { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" };
      if (method === 'GET' && path === '/admin') return send(res, 200, dashboard(db, q), undefined, adminCsp);
      if (method === 'GET' && path === '/admin/api/summary') return json(res, 200, summary(db, q));
      if (method === 'GET' && path === '/admin/api/verify-chain') return json(res, 200, verifyConnChain(db));
      if (method === 'GET' && path === '/admin/report.csv') {
        const t = tableReport(db, q.type, q);
        if (!t) return json(res, 404, { error: 'tipo inválido ou desativado' });
        audit(db, config.adminUser, 'export_csv', { type: q.type, from: q.from, to: q.to });
        return send(res, 200, toCsv(t.rows, t.cols), 'text/csv; charset=utf-8', { 'content-disposition': `attachment; filename="${q.type}.csv"` });
      }
      if (method === 'GET' && path === '/admin/lookup') {
        if (!q.ip || !q.at || Number.isNaN(Date.parse(q.at)) || !q.ref) return json(res, 400, { error: 'informe ip, at (ISO 8601 com fuso) e ref (nº do ofício/processo)' });
        audit(db, config.adminUser, 'lookup_ip', { ip: q.ip, at: q.at, ref: q.ref });
        return json(res, 200, lookupByIp(db, q.ip, q.at));
      }
      if (method === 'GET' && path === '/admin/dsr') {
        const rows = db.prepare('SELECT * FROM dsr ORDER BY id DESC LIMIT 200').all();
        return send(res, 200, v.page('Solicitações', `<h1>Solicitações de titulares</h1><table><tr><th>#</th><th>Tipo</th><th>Contato</th><th>Status</th><th>Criada</th><th></th></tr>${
          rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.kind)}</td><td>${esc(r.contact)}</td><td>${esc(r.status)}</td><td>${esc(r.created_at)}</td><td>${
            r.status === 'pendente' ? `<form method="post" action="/admin/dsr/${r.id}/complete"><button>Executar</button></form>` : ''}${
            r.user_id ? ` <a href="/admin/dsr/${r.id}/export">dados</a>` : ''}</td></tr>`).join('')}</table>`, true), undefined, adminCsp);
      }
      let m;
      if (method === 'GET' && (m = /^\/admin\/dsr\/(\d+)\/export$/.exec(path))) {
        const r = db.prepare('SELECT * FROM dsr WHERE id=?').get(Number(m[1]));
        if (!r?.user_id) return json(res, 404, { error: 'sem titular vinculado' });
        audit(db, config.adminUser, 'dsr_export', { dsr: r.id });
        return json(res, 200, exportUserData(db, r.user_id));
      }
      if (method === 'POST' && (m = /^\/admin\/dsr\/(\d+)\/complete$/.exec(path))) {
        const r = db.prepare('SELECT * FROM dsr WHERE id=?').get(Number(m[1]));
        if (!r || r.status !== 'pendente') return json(res, 404, { error: 'não encontrada' });
        let note = '';
        if (r.user_id && ['eliminacao', 'revogar_marketing'].includes(r.kind)) {
          db.prepare('INSERT INTO consents (user_id,kind,granted,policy_version,text_sha256,created_at) VALUES (?,?,?,?,?,?)')
            .run(r.user_id, 'marketing', 0, config.policyVersion, v.consentHash('marketing'), nowIso());
        }
        if (r.user_id && r.kind === 'eliminacao') {
          db.prepare('DELETE FROM nav_log WHERE user_id=?').run(r.user_id);
          db.prepare('UPDATE users SET erasure_requested_at=? WHERE id=?').run(nowIso(), r.user_id);
          const hasConn = db.prepare('SELECT 1 FROM conn_log WHERE user_id=? LIMIT 1').get(r.user_id);
          if (hasConn) note = `registros de conexão retidos por obrigação legal (art. 13 Marco Civil / LGPD art. 16, I); anonimização automática após ${config.connRetentionDays} dias`;
          else anonymizeUser(db, r.user_id);
        }
        db.prepare("UPDATE dsr SET status='concluida', done_at=?, note=? WHERE id=?").run(nowIso(), note, r.id);
        audit(db, config.adminUser, 'dsr_complete', { dsr: r.id, kind: r.kind, note });
        return send(res, 303, '', 'text/plain', { location: '/admin/dsr' });
      }
    }
    return send(res, 404, v.page('Não encontrado', '<h1>Não encontrado</h1>'));
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, e.status || 500, 'Erro interno', 'text/plain');
    });
  });
}

function dashboard(db, q) {
  const s = summary(db, q);
  const max = Math.max(1, ...s.byDay.map((d) => d.sessions));
  const bars = s.byDay.map((d) => `<tr><td>${esc(d.day)}</td><td><div style="background:#0b63ce;height:12px;width:${Math.round((d.sessions / max) * 100)}%"></div></td><td>${d.sessions}</td><td>${d.users}</td></tr>`).join('');
  const chain = verifyConnChain(db);
  const from = esc(s.period.from.slice(0, 10)); const to = esc(s.period.to.slice(0, 10));
  const qs = `from=${from}&to=${to}T23:59:59Z`;
  return v.page('Painel Wi-Fi', `<h1>Painel Wi-Fi</h1>
<form method="get" class="card">De <input type="text" name="from" value="${from}" style="width:9em"> até <input type="text" name="to" value="${to}T23:59:59Z" style="width:13em"> <button style="width:auto;padding:8px 16px;margin:0">Filtrar</button></form>
<div class="card" style="margin-top:12px"><b>${s.sessions}</b> sessões · <b>${s.uniqueUsers}</b> usuários únicos · <b>${s.newUsers}</b> novos · duração média <b>${s.avgSessionMinutes ?? '-'}</b> min · opt-in marketing <b>${s.marketingOptInRate ?? '-'}%</b></div>
<h3>Sessões por dia</h3><table><tr><th>Dia</th><th></th><th>Sessões</th><th>Usuários</th></tr>${bars}</table>
<h3>Por ponto de acesso</h3><table>${s.byAp.map((a) => `<tr><td>${esc(a.ap)}</td><td>${a.sessions}</td></tr>`).join('')}</table>
${s.navigation ? `<h3>Domínios mais acessados</h3><table><tr><th>Domínio</th><th>Acessos</th><th>Usuários</th></tr>${s.navigation.map((n) => `<tr><td>${esc(n.domain)}</td><td>${n.hits}</td><td>${n.users}</td></tr>`).join('')}</table>` : '<p class="small">Registro de navegação desativado (NAV_LOGGING=off).</p>'}
<h3>Exportações (CSV)</h3><p><a href="/admin/report.csv?type=sessions&${qs}">Sessões</a> · <a href="/admin/report.csv?type=consents&${qs}">Consentimentos</a>${s.navigation ? ` · <a href="/admin/report.csv?type=nav&${qs}">Navegação</a>` : ''} · <a href="/admin/dsr">Solicitações de titulares</a></p>
<p class="small">Integridade do registro de conexão: ${chain.ok ? `OK (${chain.checked} eventos)` : `<b>FALHA no registro ${chain.brokenAtId}</b>`}</p>`, true);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (config.secret === 'dev-secret-inseguro' || config.adminPassword === 'admin') {
    console.warn('AVISO: APP_SECRET/ADMIN_PASSWORD padrão em uso. Configure o .env antes de produção.');
  }
  const db = openDb();
  runRetention(db);
  setInterval(() => runRetention(db), 6 * 3600_000).unref();
  startSyslog(db);
  createApp(db).listen(config.port, () => console.log(`portal em :${config.port}`));
}
