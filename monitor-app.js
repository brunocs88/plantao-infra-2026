const LABEL = { up: 'Operacional', degraded: 'Instável', down: 'Fora do ar', unknown: 'Sem dados' };
const $ = (id) => document.getElementById(id);
let current = [];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDur = (sec) => {
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`;
};

function bars(buckets) {
  return buckets.map(([total, fail]) => {
    if (!total) return '<i class="bar"></i>';
    const rate = fail / total;
    if (!fail) return '<i class="bar ok" style="height:6px"></i>';
    const cls = rate >= 0.5 ? 'fail' : 'part';
    return `<i class="bar ${cls}" style="height:${Math.max(10, Math.round(rate * 100))}%" title="${fail}/${total} falhas"></i>`;
  }).join('');
}

function card(t, now) {
  const since = t.downSince ? `<div class="stat"><b>${fmtDur(now - t.downSince)}</b><span>fora do ar</span></div>` : '';
  return `<article class="card ${t.status}">
    <div class="card-head">
      <div><div class="name">${esc(t.name)}</div><div class="addr">${esc(t.host)}:${t.port}</div></div>
      <span class="pill ${t.status}">${LABEL[t.status]}</span>
    </div>
    <div class="stats">
      <div class="stat"><b>${t.latency != null ? t.latency + ' ms' : '—'}</b><span>latência</span></div>
      <div class="stat"><b>${t.uptime != null ? t.uptime.toFixed(2) + '%' : '—'}</b><span>uptime 24h</span></div>
      ${since}
    </div>
    <div class="chart" aria-label="Falhas nas últimas 24h">${bars(t.buckets)}</div>
    <div class="axis"><span>24h atrás</span><span>agora</span></div>
  </article>`;
}

function render(data) {
  current = data.targets;
  const down = current.filter((t) => t.status === 'down').length;
  const deg = current.filter((t) => t.status === 'degraded').length;
  const banner = $('banner');
  if (!current.length) { banner.className = 'banner'; banner.innerHTML = 'Nenhum alvo configurado.'; }
  else if (down) { banner.className = 'banner down'; banner.innerHTML = `<span class="dot"></span>${down} de ${current.length} fora do ar`; }
  else if (deg) { banner.className = 'banner warn'; banner.innerHTML = `<span class="dot"></span>${deg} com instabilidade`; }
  else { banner.className = 'banner up'; banner.innerHTML = '<span class="dot"></span>Todos os IPs operacionais'; }

  const order = { down: 0, degraded: 1, unknown: 2, up: 3 };
  const sorted = [...current].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  $('grid').innerHTML = sorted.map((t) => card(t, data.generatedAt)).join('');
  $('updated').textContent = 'Atualizado ' + new Date(data.generatedAt * 1000).toLocaleTimeString('pt-BR');
}

async function load() {
  try {
    const r = await fetch('/api/monitor', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    render(await r.json());
  } catch {
    $('updated').textContent = 'Falha ao atualizar';
  }
}

// ---- edição de alvos (admin) ----
$('editBtn').onclick = () => {
  const ed = $('editor');
  ed.hidden = !ed.hidden;
  if (!ed.hidden) {
    $('targetsText').value = current.map((t) => `${t.name}, ${t.host}, ${t.port}`).join('\n');
    $('admUser').value = sessionStorage.getItem('plantao-admin-user') || '';
    $('admKey').value = sessionStorage.getItem('plantao-admin-key') || '';
  }
};

$('saveBtn').onclick = async () => {
  const msg = $('saveMsg');
  const targets = $('targetsText').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, host, port] = l.split(',').map((x) => x.trim());
    return { name, host, port: Number(port) };
  });
  const user = $('admUser').value, key = $('admKey').value;
  msg.textContent = 'Salvando…';
  try {
    const r = await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-user': user, 'x-admin-key': key },
      body: JSON.stringify({ targets }),
    });
    const j = await r.json();
    if (!j.ok) { msg.textContent = j.error || 'Erro ao salvar.'; return; }
    sessionStorage.setItem('plantao-admin-user', user);
    sessionStorage.setItem('plantao-admin-key', key);
    msg.textContent = 'Salvo. Os primeiros testes aparecem em ~1 min.';
    load();
  } catch { msg.textContent = 'Erro de rede.'; }
};

load();
setInterval(load, 30000);
