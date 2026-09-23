// Salva as trocas de UM ano, preservando as dos demais anos.
async function apiSaveOverridesForCurrentYear(newYearOverrides){
  const candidate = { ...overridesByYear, [currentYear]: newYearOverrides };
  return apiSaveOverrides(candidate);
}

// admKey/adminUser já autenticados: sobe um ano de escala (planilha importada).
async function apiSaveSchedule(year, data, holidays){
  let user = adminUser, key = adminKey;
  let errorMsg = null;
  for(let attempt = 0; attempt < 3; attempt++){
    if(!user || !key){
      const creds = await promptLogin(errorMsg);
      if(!creds) return { ok:false, error:'Login cancelado.' };
      user = creds.user;
      key = creds.pass;
      errorMsg = null;
    }
    try{
      const r = await fetch('/api/schedule', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-admin-user': user, 'x-admin-key': key},
        body: JSON.stringify({ year, data, holidays })
      });
      if(r.status === 401){
        user = ''; key = '';
        adminUser = ''; adminKey = '';
        sessionStorage.removeItem('plantao-admin-user');
        sessionStorage.removeItem('plantao-admin-key');
        errorMsg = 'Usuário ou senha incorretos.';
        continue;
      }
      if(!r.ok){
        let detail = '';
        try{ const j = await r.json(); detail = j.error || ''; }catch(_e){}
        return { ok:false, error: detail ? `Erro do servidor: ${detail}` : `Não deu para conectar ao servidor (status ${r.status}). A planilha não foi salva.` };
      }
      adminUser = user; adminKey = key;
      sessionStorage.setItem('plantao-admin-user', user);
      sessionStorage.setItem('plantao-admin-key', key);
      SCHEDULES[String(year)] = { data, holidays };
      return { ok:true };
    }catch(e){
      return { ok:false, error:'Não deu para conectar ao servidor (falha de rede). A planilha não foi salva.' };
    }
  }
  return { ok:false, error:'Muitas tentativas incorretas. Tente novamente mais tarde.' };
}

function getEffectiveData(){
  const overrides = curOverrides();
  return curData().map(rec => {
    const o = overrides[rec.sabado];
    if(!o) return rec;
    return { ...rec, titular: o.titular, backup: o.backup, _override: o };
  });
}

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MESES_PT_LONG = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DIAS_PT = ['dom','seg','ter','qua','qui','sex','sáb'];

function fmtDate(iso){
  const d = new Date(iso+'T00:00:00');
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
function fmtDateFull(iso){
  const d = new Date(iso+'T00:00:00');
  return `${DIAS_PT[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

let activePerson = null;
let onlyHoliday = false;
let tableFilterPerson = '';

function renderStatusBar(){
  const TODAY = getToday();
  const bar = document.getElementById('statusbar');
  const data = getEffectiveData();
  const future = data.filter(d => new Date(d.domingo+'T00:00:00') >= TODAY);
  const past = data.length - future.length;
  const years = availableYears();
  const yearSelectHtml = years.length > 1
    ? `<select id="yearSelect" style="margin-left:10px;">${years.map(y => `<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('')}</select>`
    : '';
  bar.innerHTML = `
    <div><span class="dot"></span>hoje: <b>${fmtDateFull(TODAY.toISOString().slice(0,10))}</b> &nbsp;·&nbsp; ${past} concluídos / ${future.length} restantes de ${data.length} &nbsp;·&nbsp; <span id="liveClock" class="live-clock"></span>${yearSelectHtml}</div>
    <div>${storageAvailable ? '' : '<span style="color:var(--holiday)" title="trocas não estão sendo salvas de forma compartilhada">· trocas só nesta sessão</span>'}</div>
  `;
  const yearSel = document.getElementById('yearSelect');
  if(yearSel){
    yearSel.addEventListener('change', () => {
      currentYear = yearSel.value;
      tableFilterPerson = '';
      onlyHoliday = false;
      renderAll();
    });
  }
  tickClock();
}

function tickClock(){
  const el = document.getElementById('liveClock');
  if(!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  el.textContent = `${hh}:${mm}:${ss}`;
}
setInterval(tickClock, 1000);

function computeCounts(){
  const counts = {};
  getEffectiveData().forEach(rec => {
    if(!counts[rec.titular]) counts[rec.titular] = {titular:0, titular_fer:0, backup:0, backup_fer:0};
    counts[rec.titular].titular++;
    if(rec.tem_feriado) counts[rec.titular].titular_fer++;
    if(rec.backup){
      if(!counts[rec.backup]) counts[rec.backup] = {titular:0, titular_fer:0, backup:0, backup_fer:0};
      counts[rec.backup].backup++;
      if(rec.tem_feriado) counts[rec.backup].backup_fer++;
    }
  });
  return counts;
}

function computeTrophies(counts, titularNames){
  const trophies = {};
  if(titularNames.length === 0) return trophies;
  titularNames.forEach(n => trophies[n] = []);

  const byTitular = titularNames.slice().sort((a,b) => (counts[b]?.titular||0) - (counts[a]?.titular||0));
  const maxTitular = counts[byTitular[0]]?.titular || 0;
  const minTitular = Math.min(...titularNames.map(n => counts[n]?.titular||0));

  const byFer = titularNames.slice().sort((a,b) => (counts[b]?.titular_fer||0) - (counts[a]?.titular_fer||0));
  const maxFer = counts[byFer[0]]?.titular_fer || 0;

  titularNames.forEach(n => {
    const c = counts[n] || {titular:0, titular_fer:0};
    if(c.titular === maxTitular && maxTitular > 0) trophies[n].push({icon:'🏆', label:'mais plantões do ano'});
    if(c.titular_fer === maxFer && maxFer > 0) trophies[n].push({icon:'🕯️', label:'rei do feriado'});
    if(c.titular === minTitular && minTitular < maxTitular) trophies[n].push({icon:'🌱', label:'carga mais tranquila'});
  });
  return trophies;
}

function renderKPIs(){
  const counts = computeCounts();
  const allNames = new Set([...TITULARES, ...Object.keys(counts)]);
  // Só aparece card de titular para quem de fato tem (pelo menos) um plantão
  // como titular NESTE ano — evita que alguém desligado, sem nenhum plantão
  // no ano corrente, continue "preso" no topo do painel.
  const titularNames = [...allNames].filter(n => counts[n] && counts[n].titular > 0);
  const trophies = computeTrophies(counts, titularNames);
  const kpis = document.getElementById('kpis');
  kpis.innerHTML = '';
  titularNames.forEach(name => {
    const c = counts[name] || {titular:0, titular_fer:0, backup:0, backup_fer:0};
    const color = PERSON_COLOR_HEX[name] || '#9CA8B4';
    const badgeHtml = (trophies[name]||[]).map(t => `<span title="${t.label}" style="cursor:help;">${t.icon}</span>`).join(' ');
    const card = document.createElement('div');
    card.className = 'kpi-card' + (activePerson===name ? ' active' : '');
    card.style.setProperty('--c', color);
    card.innerHTML = `
      <div class="name"><span class="swatch"></span>${name} ${badgeHtml}</div>
      <div class="big">${c.titular}<span>plantões</span></div>
      <div class="sub"><span class="fer">${c.titular_fer} com feriado</span>${c.backup ? `<span>· ${c.backup} como backup</span>`:''}</div>
    `;
    card.onclick = () => { activePerson = activePerson===name ? null : name; renderAll(); };
    kpis.appendChild(card);
  });

  const backups = document.getElementById('backups');
  backups.innerHTML = '';
  const backupNames = [...allNames].filter(n => !titularNames.includes(n) && counts[n] && counts[n].backup > 0);
  backupNames.forEach(name => {
    const c = counts[name];
    const card = document.createElement('div');
    card.className = 'kpi-card' + (activePerson===name ? ' active' : '');
    card.style.setProperty('--c', 'var(--backup)');
    card.innerHTML = `
      <div class="name"><span class="swatch"></span>${name} <span class="muted" style="font-size:10px;font-weight:400;">(backup)</span></div>
      <div class="big">${c.backup}<span>plantões como backup</span></div>
      <div class="sub"><span class="fer">${c.backup_fer} com feriado</span></div>
    `;
    card.onclick = () => { activePerson = activePerson===name ? null : name; renderAll(); };
    backups.appendChild(card);
  });

  renderComparativeChart(counts, titularNames);
}

function renderComparativeChart(counts, titularNames){
  const wrap = document.getElementById('comparativeChart');
  if(!wrap) return;
  const max = Math.max(1, ...titularNames.map(n => counts[n]?.titular || 0));
  wrap.innerHTML = titularNames.map(name => {
    const c = counts[name] || {titular:0, titular_fer:0};
    const color = PERSON_COLOR_HEX[name] || '#9CA8B4';
    const pct = Math.round(((c.titular||0) / max) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label"><span class="sw" style="background:${color}"></span>${name}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%; background:${color};"></div>
        </div>
        <div class="bar-value">${c.titular}${c.titular_fer ? ` <span style="color:var(--holiday)">(${c.titular_fer} 🔶)</span>` : ''}</div>
      </div>
    `;
  }).join('');
}

function pad(n){ return String(n).padStart(2,'0'); }
function isoLocal(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }

// Datas de sexta anterior/segunda seguinte a um plantão, SÓ quando essa data
// específica coincide com um feriado que já entrou em rec.feriados. É o que
// materializa "feriado prolongado": mesma dupla titular/backup do fim de
// semana cobre também a sexta ou a segunda quando ela vira ponto de plantão.
function extendedCoverageDates(rec){
  const sab = new Date(rec.sabado+'T00:00:00');
  const dom = new Date(rec.domingo+'T00:00:00');
  const sexta = new Date(sab); sexta.setDate(sab.getDate()-1);
  const segunda = new Date(dom); segunda.setDate(dom.getDate()+1);
  const sextaIso = isoLocal(sexta.getFullYear(), sexta.getMonth(), sexta.getDate());
  const segundaIso = isoLocal(segunda.getFullYear(), segunda.getMonth(), segunda.getDate());
  const extra = [];
  if((rec.feriados||[]).some(f => f.data === sextaIso)) extra.push(sextaIso);
  if((rec.feriados||[]).some(f => f.data === segundaIso)) extra.push(segundaIso);
  return extra;
}

function buildDayMap(){
  const map = {};
  getEffectiveData().forEach(rec => {
    map[rec.sabado] = rec;
    map[rec.domingo] = rec;
    extendedCoverageDates(rec).forEach(iso => { map[iso] = rec; });
  });
  return map;
}

function getNextShiftKey(){
  const TODAY = getToday();
  const future = getEffectiveData()
    .filter(d => new Date(d.domingo+'T00:00:00') >= TODAY)
    .sort((a,b) => a.sabado.localeCompare(b.sabado));
  return future[0] ? future[0].sabado : null;
}

function renderCalendarYear(){
  const TODAY = getToday();
  const dayMap = buildDayMap();
  const nextKey = getNextShiftKey();
  const container = document.getElementById('calendarYear');
  container.innerHTML = '';
  const year = parseInt(currentYear, 10);

  for(let m=0; m<12; m++){
    const card = document.createElement('div');
    card.className = 'month-card';

    const title = document.createElement('div');
    title.className = 'month-title';
    title.textContent = MESES_PT_LONG[m];
    card.appendChild(title);

    const dow = document.createElement('div');
    dow.className = 'dow-row';
    dow.innerHTML = ['D','S','T','Q','Q','S','S'].map(d=>`<span>${d}</span>`).join('');
    card.appendChild(dow);

    const grid = document.createElement('div');
    grid.className = 'days-grid';

    const firstDate = new Date(year, m, 1);
    const firstWeekday = firstDate.getDay();
    const daysInMonth = new Date(year, m+1, 0).getDate();

    for(let i=0;i<firstWeekday;i++){
      const e = document.createElement('div');
      e.className = 'day-cell empty';
      grid.appendChild(e);
    }

    for(let d=1; d<=daysInMonth; d++){
      const iso = isoLocal(year, m, d);
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      cell.textContent = d;

      const rec = dayMap[iso];
      const hol = curHolidays()[iso];
      const dateObj = new Date(year, m, d);

      if(rec){
        cell.classList.add('plantao');
        const isExtended = iso !== rec.sabado && iso !== rec.domingo;
        if(isExtended) cell.classList.add('plantao-extended');
        cell.style.setProperty('--c', PERSON_COLOR_HEX[rec.titular] || '#888');
        const isPast = new Date(rec.domingo+'T00:00:00') < TODAY;
        if(isPast) cell.classList.add('past');
        if(rec._override) cell.classList.add('overridden');
        if(nextKey && rec.sabado === nextKey) cell.classList.add('next-shift');
        if(activePerson && rec.titular !== activePerson && rec.backup !== activePerson){
          cell.classList.add('dim');
        }
        if(onlyHoliday && !rec.tem_feriado){
          cell.classList.add('dim');
        }
        if(rec.backup){
          const bd = document.createElement('div');
          bd.className = 'backup-dot';
          cell.appendChild(bd);
        }
        if(isAdmin()){
          const editDot = document.createElement('div');
          editDot.className = 'edit-dot';
          editDot.textContent = '✎';
          editDot.addEventListener('click', (ev) => { ev.stopPropagation(); openSwapModal(rec.sabado); });
          cell.appendChild(editDot);
        }

        cell.addEventListener('mouseenter', (e) => showTooltip(e, rec, iso, hol));
        cell.addEventListener('mousemove', moveTooltip);
        cell.addEventListener('mouseleave', hideTooltip);
      } else if(hol){
        cell.addEventListener('mouseenter', (e) => showTooltip(e, null, iso, hol));
        cell.addEventListener('mousemove', moveTooltip);
        cell.addEventListener('mouseleave', hideTooltip);
      }

      if(hol){
        const ring = document.createElement('div');
        ring.className = 'hol-ring' + (hol.categoria === 'facultativo' ? ' facultativo' : '');
        cell.appendChild(ring);
      }

      if(dateObj.getTime() === TODAY.getTime()){
        cell.classList.add('is-today');
      }

      grid.appendChild(cell);
    }

    card.appendChild(grid);
    container.appendChild(card);
  }

  const legend = document.getElementById('rackLegend');
  legend.innerHTML = Object.keys(PERSON_COLOR_HEX).map(name =>
    `<div class="item"><span class="sw" style="background:${PERSON_COLOR_HEX[name]}"></span>${name}</div>`
  ).join('') + `
    <div class="item"><span class="dot"></span>tem backup</div>
    <div class="item"><span class="diamond"></span>feriado</div>
    <div class="item"><span class="diamond dashed"></span>ponto facultativo</div>
    <div class="item"><span class="ring-sample"></span>próximo plantão</div>
    <div class="item"><span class="stripe-sample"></span>feriado prolongado (sexta/segunda, mesma dupla)</div>
  `;
}

function fmtHolName(f){
  return f.nome + (f.categoria === 'facultativo' ? ' <i style="opacity:.7">(facultativo)</i>' : '');
}

function showTooltip(e, rec, iso, hol){
  const tt = document.getElementById('tooltip');
  if(rec){
    const isExtended = iso !== rec.sabado && iso !== rec.domingo;
    const ferHtml = rec.tem_feriado
      ? `<div class="t-fer">🔶 ${rec.feriados.map(fmtHolName).join(', ')}</div>`
      : '';
    const extHtml = isExtended
      ? `<div class="t-line" style="color:var(--next)">📅 feriado prolongado — mesma dupla do fim de semana</div>`
      : '';
    const ovHtml = rec._override
      ? `<div class="t-line" style="color:var(--today)">↔ trocado (era ${rec._override.original_titular}${rec._override.original_backup? ' + '+rec._override.original_backup:''})${rec._override.motivo ? ' · '+rec._override.motivo : ''}</div>`
      : '';
    tt.innerHTML = `
      <div class="t-title">${fmtDateFull(rec.sabado)} – ${fmtDateFull(rec.domingo)}</div>
      ${extHtml}
      <div class="t-line">Titular: <b style="color:${PERSON_COLOR_HEX[rec.titular]||'#fff'}">${rec.titular}</b></div>
      ${rec.backup ? `<div class="t-line">Backup: ${rec.backup}</div>` : ''}
      ${ferHtml}
      ${ovHtml}
    `;
  } else if(hol){
    tt.innerHTML = `
      <div class="t-title">${fmtDateFull(iso)}</div>
      <div class="t-fer">🔶 ${fmtHolName(hol)}</div>
      <div class="t-line">${hol.categoria}</div>
    `;
  }
  tt.classList.add('show');
  moveTooltip(e);
}
function moveTooltip(e){
  const tt = document.getElementById('tooltip');
  const offset = 16;
  let x = e.clientX + offset;
  let y = e.clientY + offset;
  if(x + 240 > window.innerWidth) x = e.clientX - 240 - offset;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}
function hideTooltip(){
  document.getElementById('tooltip').classList.remove('show');
}

function renderTable(){
  const TODAY = getToday();
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  const nextKey = getNextShiftKey();
  let rows = getEffectiveData();
  if(onlyHoliday) rows = rows.filter(r => r.tem_feriado);
  if(tableFilterPerson) rows = rows.filter(r => r.titular === tableFilterPerson || r.backup === tableFilterPerson);

  rows.forEach((rec, i) => {
    const tr = document.createElement('tr');
    const isPast = new Date(rec.domingo+'T00:00:00') < TODAY;
    const classes = [];
    if(isPast) classes.push('is-past');
    if(rec.sabado === nextKey) classes.push('is-next');
    tr.className = classes.join(' ');
    const color = PERSON_COLOR_HEX[rec.titular] || '#999';
    const ovBadge = rec._override ? ' <span title="trocado" style="color:var(--today)">↔</span>' : '';
    tr.innerHTML = `
      <td class="muted">${rec.sabado === nextKey ? '▶' : i+1}</td>
      <td>${fmtDateFull(rec.sabado)}</td>
      <td>${fmtDateFull(rec.domingo)}</td>
      <td><span class="tag-person"><span class="sw" style="background:${color}"></span>${rec.titular}</span>${ovBadge}</td>
      <td>${rec.backup || '<span class="muted">—</span>'}</td>
      <td>${rec.tem_feriado ? `<span class="fer-pill">${rec.feriados.map(fmtHolName).join(', ')}</span>` : '<span class="muted">—</span>'}</td>
      <td>${isAdmin() ? `<button class="btn btn-ghost" style="padding:4px 8px;" data-key="${rec.sabado}">editar</button>` : ''}</td>
    `;
    if(isAdmin()){
      tr.querySelector('button').addEventListener('click', () => openSwapModal(rec.sabado));
    }
    tbody.appendChild(tr);
  });
}
