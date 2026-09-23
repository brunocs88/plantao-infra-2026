function showGenerateError(msg){
  const box = document.getElementById('generateBox');
  let el = box.querySelector('.modal-error');
  if(!el){
    el = document.createElement('div');
    el.className = 'modal-error';
    el.style.cssText = 'color:var(--today); font-size:11px; margin-top:10px;';
    box.querySelector('.modal-actions').before(el);
  }
  el.textContent = '⚠ ' + msg;
}

async function confirmGenerate(){
  const preview = generateState.preview;
  const year = parseInt(generateState.year, 10);
  if(!preview || !year) return;
  const result = await apiSaveSchedule(year, preview.data, preview.holidays);
  if(!result.ok){
    showGenerateError(result.error);
    return;
  }
  currentYear = String(year);
  fireConfetti();
  closeGenerateModal();
  renderAll();
}

// ---- Exportar planilha do ano atual ----
function capitalizeFirst(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function buildRawLine(rec){
  const sab = new Date(rec.sabado+'T00:00:00');
  const dom = new Date(rec.domingo+'T00:00:00');
  const line = `${pad2(sab.getDate())} e ${pad2(dom.getDate())}: ${rec.titular}`;
  return rec.backup ? `${line} (+ ${rec.backup})` : line;
}
function exportScheduleXLSX(){
  const year = currentYear;
  const data = getEffectiveData(); // reflete trocas/substituições aplicadas
  const holidays = curHolidays();

  const rows = [];
  let curMonth = -1;
  data.forEach(rec => {
    const d = new Date(rec.sabado+'T00:00:00');
    const m = d.getMonth();
    if(m !== curMonth){
      rows.push([capitalizeFirst(MESES_PT_LONG[m])]);
      curMonth = m;
    }
    rows.push([buildRawLine(rec)]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);

  const holRows = [['Data','Nome','Categoria']];
  Object.entries(holidays).sort((a,b) => a[0].localeCompare(b[0])).forEach(([iso,h]) => {
    holRows.push([iso, h.nome, h.categoria]);
  });
  const wsHol = XLSX.utils.aoa_to_sheet(holRows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `PLANTAO ${year}`.slice(0,31));
  XLSX.utils.book_append_sheet(wb, wsHol, 'Feriados');
  XLSX.writeFile(wb, `plantao_${year}.xlsx`);
}
document.getElementById('exportScheduleBtn').addEventListener('click', exportScheduleXLSX);

// ---- Trocar posições de duas pessoas no ano ----
// Troca todo mundo que era titular/backup de A para B e vice-versa, no ano
// atual inteiro (passado e futuro). Cada um assume exatamente o que o outro
// tinha, incluindo feriados e a virada do ano — as datas não mudam.
function swapPeopleInYear(data, nameA, nameB){
  return data.map(rec => {
    let titular = rec.titular, backup = rec.backup;
    if(titular === nameA) titular = nameB;
    else if(titular === nameB) titular = nameA;
    if(backup === nameA) backup = nameB;
    else if(backup === nameB) backup = nameA;
    const changed = (titular !== rec.titular || backup !== rec.backup);
    return changed ? { ...rec, titular, backup, raw: buildRawLine({ ...rec, titular, backup }) } : rec;
  });
}

let swapPeopleState = { a: null, b: null };

function openSwapPeopleModal(){
  swapPeopleState = { a: null, b: null };
  document.getElementById('swapPeopleOverlay').classList.add('show');
  buildSwapPeopleModal();
}
function closeSwapPeopleModal(){
  document.getElementById('swapPeopleOverlay').classList.remove('show');
}
document.getElementById('swapPeopleOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'swapPeopleOverlay') closeSwapPeopleModal();
});

function buildSwapPeopleModal(){
  const box = document.getElementById('swapPeopleBox');
  const { a, b } = swapPeopleState;
  let affected = 0;
  if(a && b && a !== b){
    affected = curData().filter(r => [r.titular, r.backup].includes(a) || [r.titular, r.backup].includes(b)).length;
  }
  // Um assistente (Edvaldo, Randal) nunca pode virar titular — se as duas
  // pessoas escolhidas não forem "do mesmo tipo" (ambas titulares ou ambas
  // assistentes), a troca herdaria plantões sozinhos para um assistente.
  const invalidSwap = !!(a && b && a !== b && (podeSerTitular(a) !== podeSerTitular(b)));
  const opts = (selected) => ALL_PEOPLE.map(p => `<option value="${p}" ${selected===p?'selected':''}>${p}</option>`).join('');

  box.innerHTML = `
    <h3>Trocar posições no ano ${currentYear}</h3>
    <div class="modal-sub">Tudo que era da pessoa A passa a ser da pessoa B, e vice-versa — plantões, backups e feriados, no ano inteiro (passado e futuro). As datas continuam as mesmas, só os nomes trocam de lugar.</div>

    <label class="field-label">Pessoa A</label>
    <select id="swapASelect"><option value="">— selecionar —</option>${opts(a)}</select>

    <label class="field-label" style="margin-top:12px;">Pessoa B</label>
    <select id="swapBSelect"><option value="">— selecionar —</option>${opts(b)}</select>

    ${a && b && a !== b ? `<div class="modal-sub" style="margin-top:10px;"><b>${affected}</b> plantão(ões) serão afetados.</div>` : ''}
    ${invalidSwap ? `<div class="modal-sub" style="margin-top:6px; color:var(--holiday);">⚠ ${ASSISTENTES.includes(a) ? a : b} é assistente (só backup) e não pode assumir plantão como titular — essa troca não é permitida.</div>` : ''}

    <div class="modal-actions">
      <div></div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" id="swapCancelBtn">cancelar</button>
        <button class="btn btn-primary" id="swapConfirmBtn" ${(!a || !b || a===b || affected===0 || invalidSwap) ? 'disabled' : ''}>trocar</button>
      </div>
    </div>
  `;

  box.querySelector('#swapASelect').addEventListener('change', (e) => {
    swapPeopleState.a = e.target.value || null;
    buildSwapPeopleModal();
  });
  box.querySelector('#swapBSelect').addEventListener('change', (e) => {
    swapPeopleState.b = e.target.value || null;
    buildSwapPeopleModal();
  });
  box.querySelector('#swapCancelBtn').addEventListener('click', closeSwapPeopleModal);
  const confirmBtn = box.querySelector('#swapConfirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click', confirmSwapPeople);
}

async function confirmSwapPeople(){
  const { a, b } = swapPeopleState;
  if(!a || !b || a === b) return;
  const swapped = swapPeopleInYear(curData(), a, b);
  const result = await apiSaveSchedule(currentYear, swapped, curHolidays());
  if(!result.ok){
    showSwapPeopleError(result.error);
    return;
  }
  fireConfetti();
  closeSwapPeopleModal();
  renderAll();
}

function showSwapPeopleError(msg){
  const box = document.getElementById('swapPeopleBox');
  let el = box.querySelector('.modal-error');
  if(!el){
    el = document.createElement('div');
    el.className = 'modal-error';
    el.style.cssText = 'color:var(--today); font-size:11px; margin-top:10px;';
    box.querySelector('.modal-actions').before(el);
  }
  el.textContent = '⚠ ' + msg;
}

function isAdmin(){
  return !!(adminUser && adminKey);
}

function renderAdminBar(){
  const bar = document.getElementById('adminbar');
  if(isAdmin()){
    bar.innerHTML = `
      <span class="badge-admin"><span class="dotgreen"></span>logado como <b>${adminUser}</b></span>
      <button class="btn btn-ghost" id="generateYearBtn" style="padding:6px 14px;">🗓️ gerar novo ano</button>
      <button class="btn btn-ghost" id="swapPeopleBtn" style="padding:6px 14px;">🔀 trocar posições</button>
      <button class="btn btn-ghost" id="importScheduleBtn" style="padding:6px 14px;">📤 importar planilha</button>
      <button class="btn btn-ghost" id="replaceEmployeeBtn" style="padding:6px 14px;">🔁 substituir funcionário</button>
      <button class="btn btn-ghost" id="logoutBtn" style="padding:6px 14px;">sair</button>
    `;
    bar.querySelector('#logoutBtn').addEventListener('click', logoutAdmin);
    bar.querySelector('#replaceEmployeeBtn').addEventListener('click', openReplaceModal);
    bar.querySelector('#importScheduleBtn').addEventListener('click', openImportModal);
    bar.querySelector('#generateYearBtn').addEventListener('click', openGenerateModal);
    bar.querySelector('#swapPeopleBtn').addEventListener('click', openSwapPeopleModal);
  } else {
    bar.innerHTML = `
      <button class="btn-admin-enter" id="loginBtn"><span class="lock">🔒</span>entrar como admin</button>
    `;
    bar.querySelector('#loginBtn').addEventListener('click', loginAsAdmin);
  }
}

async function loginAsAdmin(){
  const result = await apiSaveOverrides(overridesByYear);
  if(!result.ok && result.error !== 'Login cancelado.'){
    alert('⚠ ' + result.error);
  }
  if(result.ok) fireConfetti();
  renderAll();
}

function logoutAdmin(){
  adminUser = '';
  adminKey = '';
  sessionStorage.removeItem('plantao-admin-user');
  sessionStorage.removeItem('plantao-admin-key');
  renderAll();
}

// ---- Contatos WhatsApp (para o card de plantão ativo) ----
const PHONE_MAP = {
  'Estanis': '5512997470211',
  'Pedro': '5512996856347',
  'Bruno': '5512996865083',
  'Vitor': '5512997650203',
  'Edvaldo': '5512992508714',
  'Randal': '5512991675417',
};
function waLink(name, role){
  const phone = PHONE_MAP[name];
  if(!phone) return null;
  const msg = encodeURIComponent(`Olá, ${name}! Preciso de suporte`);
  return `https://wa.me/${phone}?text=${msg}`;
}
function renderHeroCard(){
  const card = document.getElementById('heroCard');
  const TODAY = getToday();
  const data = getEffectiveData();

  const current = data.find(r => {
    const sab = new Date(r.sabado+'T00:00:00');
    const dom = new Date(r.domingo+'T00:00:00');
    return TODAY >= sab && TODAY <= dom;
  });
  const rec = current || data
    .filter(r => new Date(r.sabado+'T00:00:00') >= TODAY)
    .sort((a,b) => a.sabado.localeCompare(b.sabado))[0];

  if(!rec){
    card.innerHTML = '';
    return;
  }

  const isAndamento = !!current;
  let statusLabel;
  if(isAndamento){
    statusLabel = 'Plantão em andamento';
  } else {
    const dias = Math.round((new Date(rec.sabado+'T00:00:00') - TODAY) / 86400000);
    statusLabel = dias === 0 ? 'Inicia hoje' : dias === 1 ? 'Inicia amanhã' : `Inicia em ${dias}d`;
  }

  const titularLink = waLink(rec.titular, 'titular');
  const backupLink = rec.backup ? waLink(rec.backup, 'backup') : null;

  card.innerHTML = `
    <div class="hero-card-left">
      <span class="hero-card-badge"><span class="pulse-dot"></span>${statusLabel}</span>
      <div class="hero-card-title"><span class="role-label">Titular</span>${rec.titular}${rec.backup ? ` <span class="role-label" style="margin-left:10px;">Backup</span>${rec.backup}` : ''}</div>
      <div class="hero-card-dates">${fmtDateFull(rec.sabado)} – ${fmtDateFull(rec.domingo)}${rec.tem_feriado ? ' · 🔶 tem feriado' : ''}</div>
    </div>
    <div class="hero-card-actions">
      ${titularLink ? `<a class="wa-btn" href="${titularLink}" target="_blank" rel="noopener">📞 ${rec.titular}</a>` : ''}
      ${backupLink ? `<a class="wa-btn backup-btn" href="${backupLink}" target="_blank" rel="noopener">📞 ${rec.backup}</a>` : ''}
    </div>
  `;
  card.classList.toggle('andamento', isAndamento);
}

function renderAll(){
  document.title = `Plantão Infra · ${currentYear}`;
  const heroYear = document.getElementById('heroYear');
  if(heroYear) heroYear.textContent = `Plantão ${currentYear}`;
  computeAllPeople();
  renderAdminBar();
  renderHeroCard();
  renderStatusBar();
  renderKPIs();
  renderCalendarYear();
  renderTable();
  renderPersonFilter();
  renderHistory();
}

(async function init(){
  await loadSchedules();
  await loadOverrides();
  renderAll();
})();
