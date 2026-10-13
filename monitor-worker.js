// Monitoramento de IPs públicos (estilo Downdetector).
// Um Cron Trigger (a cada 1 min) testa conexão TCP em cada alvo e guarda o
// histórico no Upstash Redis. O painel (monitor.html) lê /api/monitor.

const TARGETS_KEY = 'monitor-targets';
const HIST_KEY = (id) => `monitor-h:${id}`;
const HIST_MAX = 1440;          // 24h de histórico a 1 teste/min
const MAX_TARGETS = 30;
const CONCURRENCY = 6;          // limite de conexões simultâneas do Worker
const TIMEOUT_MS = 3000;
const BUCKET_MIN = 15;          // barras de 15 min no gráfico das últimas 24h

// Obs.: Workers não conseguem abrir socket para IPs da própria Cloudflare (ex.: 1.1.1.1).
const DEFAULT_TARGETS = [
  { id: 'google-dns-1', name: 'Google DNS', host: '8.8.8.8', port: 53 },
  { id: 'google-dns-2', name: 'Google DNS (sec.)', host: '8.8.4.4', port: 53 },
  { id: 'quad9', name: 'Quad9 DNS', host: '9.9.9.9', port: 53 },
  { id: 'opendns', name: 'OpenDNS', host: '208.67.222.222', port: 53 },
];

// ---------- validação ----------

function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0);
}

export function validateTargets(list) {
  if (!Array.isArray(list)) return { error: 'Lista de alvos inválida.' };
  if (list.length > MAX_TARGETS) return { error: `Máximo de ${MAX_TARGETS} alvos.` };
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const name = String(t?.name ?? '').trim().slice(0, 60);
    const host = String(t?.host ?? '').trim().toLowerCase();
    const port = Number(t?.port);
    if (!name) return { error: 'Todo alvo precisa de um nome.' };
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const isName = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host);
    if (!isIp && !isName) return { error: `Host inválido: ${host || '(vazio)'}` };
    if (isIp && (host.split('.').some((o) => Number(o) > 255) || isPrivateIPv4(host))) {
      return { error: `Somente IPs públicos são permitidos: ${host}` };
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: `Porta inválida em ${host}.` };
    let id = String(t?.id ?? '').trim() || `${host}-${port}`;
    id = id.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 80);
    if (seen.has(id)) return { error: `Alvo duplicado: ${host}:${port}` };
    seen.add(id);
    out.push({ id, name, host, port });
  }
  return { targets: out };
}

// ---------- sondagem ----------

async function tcpProbe(host, port) {
  const { connect } = await import('cloudflare:sockets');
  const t0 = Date.now();
  let timer;
  let socket;
  try {
    socket = connect({ hostname: host, port });
    await Promise.race([
      socket.opened,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS); }),
    ]);
    return { ok: true, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: null };
  } finally {
    clearTimeout(timer);
    try { socket?.close(); } catch { /* ignore */ }
  }
}

// 2 tentativas: só conta como falha se ambas falharem (evita falso alarme).
async function probe(target) {
  const first = await tcpProbe(target.host, target.port);
  return first.ok ? first : tcpProbe(target.host, target.port);
}

async function pool(items, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

export async function loadTargets(redis) {
  const saved = await redis.get(TARGETS_KEY);
  return Array.isArray(saved) ? saved : DEFAULT_TARGETS;
}

export async function runProbes(redis) {
  const targets = await loadTargets(redis);
  const now = Math.floor(Date.now() / 1000);
  const results = [];
  await pool(targets, async (t) => { results.push([t.id, await probe(t)]); });

  const p = redis.pipeline();
  for (const [id, r] of results) {
    p.lpush(HIST_KEY(id), `${now},${r.ok ? 1 : 0},${r.ms ?? 0}`);
    p.ltrim(HIST_KEY(id), 0, HIST_MAX - 1);
  }
  await p.exec();
  return results.length;
}

// ---------- leitura / estatísticas ----------

function parseHistory(rows) {
  return (rows || []).map((r) => {
    const [ts, ok, ms] = String(r).split(',').map(Number);
    return { ts, ok: ok === 1, ms };
  }); // mais recente primeiro
}

export function summarize(target, hist, nowSec = Math.floor(Date.now() / 1000)) {
  const last = hist[0];
  const recent = hist.slice(0, 5);
  const fails = recent.filter((h) => !h.ok).length;
  let status = 'unknown';
  if (last) {
    if (fails === recent.length) status = 'down';
    else if (fails > 0) status = 'degraded';
    else status = 'up';
    if (nowSec - last.ts > 300) status = 'unknown'; // sem dados recentes (cron parado?)
  }

  const okMs = hist.filter((h) => h.ok).map((h) => h.ms);
  const uptime = hist.length ? (hist.filter((h) => h.ok).length / hist.length) * 100 : null;
  const latency = last?.ok ? last.ms : null;
  const avgMs = okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : null;

  // buckets de 15 min, do mais antigo para o mais novo (96 barras)
  const n = (24 * 60) / BUCKET_MIN;
  const size = BUCKET_MIN * 60;
  const startBucket = Math.floor(nowSec / size) - (n - 1);
  const buckets = Array.from({ length: n }, () => ({ total: 0, fail: 0 }));
  for (const h of hist) {
    const i = Math.floor(h.ts / size) - startBucket;
    if (i < 0 || i >= n) continue;
    buckets[i].total++;
    if (!h.ok) buckets[i].fail++;
  }

  // incidente atual: há quanto tempo está fora (falhas consecutivas desde o último ok)
  let downSince = null;
  if (status === 'down') {
    const lastOk = hist.find((h) => h.ok);
    const failing = hist.filter((h) => !h.ok && (!lastOk || h.ts > lastOk.ts));
    downSince = failing.length ? failing[failing.length - 1].ts : last.ts;
  }

  return {
    id: target.id, name: target.name, host: target.host, port: target.port,
    status, latency, avgMs, uptime, downSince, lastCheck: last?.ts ?? null,
    buckets: buckets.map((b) => [b.total, b.fail]),
  };
}

export async function getOverview(redis) {
  const targets = await loadTargets(redis);
  const p = redis.pipeline();
  for (const t of targets) p.lrange(HIST_KEY(t.id), 0, HIST_MAX - 1);
  const rows = targets.length ? await p.exec() : [];
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    bucketMinutes: BUCKET_MIN,
    targets: targets.map((t, i) => summarize(t, parseHistory(rows[i]))),
  };
}

export async function saveTargets(redis, list) {
  const v = validateTargets(list);
  if (v.error) return v;
  await redis.set(TARGETS_KEY, v.targets);
  return { ok: true, targets: v.targets };
}
