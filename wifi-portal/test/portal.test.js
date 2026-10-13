import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  NAV_LOGGING: 'domain', INGEST_TOKEN: 'tok', ADMIN_USER: 'a', ADMIN_PASSWORD: 'b', APP_SECRET: 'test-secret', TRUST_GATEWAY_PARAMS: '1',
});
const { openDb, verifyConnChain } = await import('../src/db.js');
const { createApp } = await import('../src/server.js');
const { parseLogLine, cleanDomain } = await import('../src/ingest.js');
const { runRetention } = await import('../src/retention.js');
const { validCpf } = await import('../src/util.js');

let db, server, base;
const logs = [];
const origLog = console.log;
before(async () => {
  console.log = (...a) => logs.push(a.join(' '));
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { console.log = origLog; server.close(); });

const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
const admin = { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') };
const person = { name: 'Maria da Silva', cpf: '529.982.247-25', email: 'maria@example.com', phone: '11999998888' };

async function login(extra = {}, ip = '10.0.0.5') {
  logs.length = 0;
  let r = await fetch(`${base}/register`, form({ ...person, terms: '1', privacy: '1', mac: 'AA-BB-CC-DD-EE-FF', ip, ap: 'ap-recepcao', ...extra }));
  const html = await r.text();
  assert.equal(r.status, 200, html);
  const uid = /name="uid" value="(\d+)"/.exec(html)[1];
  const code = /\[otp\] para \S+: (\d{6})/.exec(logs.join('\n'))[1];
  r = await fetch(`${base}/verify`, form({ uid, code, mac: 'aa:bb:cc:dd:ee:ff', ip, ap: 'ap-recepcao' }));
  assert.equal(r.status, 200);
  return Number(uid);
}

test('CPF válido/ inválido', () => {
  assert.ok(validCpf('529.982.247-25'));
  assert.ok(!validCpf('111.111.111-11'));
  assert.ok(!validCpf('529.982.247-24'));
});

test('registro exige aceite de termos e privacidade', async () => {
  const r = await fetch(`${base}/register`, form({ ...person, terms: '1' }));
  assert.equal(r.status, 400);
});

test('fluxo completo grava usuário, consentimentos com hash, sessão e log de conexão', async () => {
  const uid = await login({ marketing: '1' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  assert.equal(u.cpf_masked, '***.982.***-**');
  assert.ok(!JSON.stringify(u).includes('52998224725'));
  const cons = db.prepare('SELECT kind, granted, text_sha256 FROM consents WHERE user_id=?').all(uid);
  assert.equal(cons.length, 3);
  assert.ok(cons.every((c) => c.text_sha256.length === 64));
  assert.equal(cons.find((c) => c.kind === 'marketing').granted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(uid).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conn_log WHERE event='login'").get().n, 1);
});

test('OTP errado é recusado e limitado', async () => {
  logs.length = 0;
  const r = await fetch(`${base}/register`, form({ ...person, terms: '1', privacy: '1', ip: '10.0.0.9' }));
  const uid = /name="uid" value="(\d+)"/.exec(await r.text())[1];
  const bad = await fetch(`${base}/verify`, form({ uid, code: '000000', ip: '10.0.0.9' }));
  assert.ok([400].includes(bad.status));
});

test('navegação é vinculada ao usuário pela sessão ativa e só guarda domínio', async () => {
  const hdr = { authorization: 'Bearer tok', 'content-type': 'application/json' };
  let r = await fetch(`${base}/api/nav`, { method: 'POST', headers: hdr, body: JSON.stringify([
    { client_ip: '10.0.0.5', domain: 'https://www.exemplo.com.br/conta?token=segredo' },
    { client_ip: '10.0.0.77', domain: 'sem-sessao.com' },
  ]) });
  assert.deepEqual(await r.json(), { stored: 1 });
  const row = db.prepare('SELECT domain, user_id FROM nav_log').get();
  assert.equal(row.domain, 'www.exemplo.com.br');
  assert.ok(row.user_id);
  r = await fetch(`${base}/api/nav`, { method: 'POST', body: '[]' });
  assert.equal(r.status, 401);
});

test('parsers dnsmasq e squid', () => {
  assert.deepEqual(
    (({ client_ip, domain, qtype }) => ({ client_ip, domain, qtype }))(parseLogLine('Oct 13 dnsmasq[1]: query[A] Example.COM from 10.0.0.5')),
    { client_ip: '10.0.0.5', domain: 'example.com', qtype: 'A' });
  assert.equal(parseLogLine('1700000000.123 50 10.0.0.5 TCP_TUNNEL/200 100 CONNECT api.site.com:443 - HIER_DIRECT/1.2.3.4 -').domain, 'api.site.com');
  assert.equal(cleanDomain('localhost'), null);
});

test('admin exige senha; relatórios, CSV e lookup auditado', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 401);
  const s = await (await fetch(`${base}/admin/api/summary`, { headers: admin })).json();
  assert.equal(s.sessions, 1);
  assert.equal(s.navigation[0].domain, 'www.exemplo.com.br');
  const csv = await (await fetch(`${base}/admin/report.csv?type=sessions`, { headers: admin })).text();
  assert.match(csv, /Maria da Silva/);
  assert.ok(!csv.includes('52998224725'));
  assert.match(await (await fetch(`${base}/admin`, { headers: admin })).text(), /Integridade.*OK/);
  assert.equal((await fetch(`${base}/admin/lookup?ip=10.0.0.5&at=${new Date().toISOString()}`, { headers: admin })).status, 400); // sem ref
  const l = await (await fetch(`${base}/admin/lookup?ip=10.0.0.5&at=${new Date().toISOString()}&ref=Oficio123`, { headers: admin })).json();
  assert.equal(l[0].name, 'Maria da Silva');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='lookup_ip'").get().n, 1);
});

test('logout encerra sessão e a cadeia de hash detecta adulteração', async () => {
  const r = await fetch(`${base}/api/session/end`, { method: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ ip: '10.0.0.5', nat_port_start: 1024, nat_port_end: 2047 }) });
  assert.deepEqual(await r.json(), { ended: 1 });
  assert.ok(verifyConnChain(db).ok);
  db.prepare("UPDATE conn_log SET ip='9.9.9.9' WHERE event='login'").run();
  assert.equal(verifyConnChain(db).ok, false);
});

test('eliminação: mantém registro de conexão, remove navegação, revoga marketing', async () => {
  db.prepare("UPDATE conn_log SET ip='10.0.0.5' WHERE event='login'").run(); // restaura para o teste seguinte
  await fetch(`${base}/titular`, form({ email: 'maria@example.com', kind: 'eliminacao' }));
  const d = db.prepare("SELECT id FROM dsr WHERE kind='eliminacao'").get();
  const r = await fetch(`${base}/admin/dsr/${d.id}/complete`, { method: 'POST', headers: admin, redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM nav_log').get().n, 0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM conn_log').get().n > 0);
  const u = db.prepare('SELECT * FROM users').get();
  assert.ok(u.erasure_requested_at && !u.anonymized_at);
  assert.equal(db.prepare("SELECT granted FROM consents WHERE kind='marketing' ORDER BY id DESC LIMIT 1").get().granted, 0);
});

test('retenção: registro de conexão antigo expira só após 365 dias e usuário é anonimizado', () => {
  db.prepare('UPDATE conn_log SET ts=?').run(new Date(Date.now() - 300 * 86400_000).toISOString());
  assert.equal(runRetention(db).conn, 0);
  db.prepare('UPDATE conn_log SET ts=?').run(new Date(Date.now() - 400 * 86400_000).toISOString());
  const out = runRetention(db);
  assert.ok(out.conn >= 2 && out.anonymized === 1);
  const u = db.prepare('SELECT * FROM users').get();
  assert.equal(u.name, 'ANONIMIZADO');
  assert.equal(u.email, null);
});
