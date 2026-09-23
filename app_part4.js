// ---- Importação de planilha (admin) ----
// Replica o formato original da aba "PLANTÃO <ano>": um cabeçalho com o nome
// do mês (ex: "Janeiro"), seguido de linhas "DD e DD: Titular (+ Backup)".
// Uma aba opcional "Feriados" (Data | Nome | Categoria) alimenta o cálculo
// de feriados (mesma janela sexta-anterior/sábado/domingo/segunda-seguinte
// usada no restante do painel).
const MESES_NORM = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const SHIFT_LINE_RE = /^\s*(\d{1,2})\s*e\s*(\d{1,2})\s*:\s*([^(]+?)\s*(?:\(\s*\+\s*([^)]+?)\s*\))?\s*$/i;

function stripAccents(s){ return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function pad2(n){ return String(n).padStart(2,'0'); }
function isoFrom(y,m,d){ return `${y}-${pad2(m+1)}-${pad2(d)}`; }

function matchMonthHeader(text){
  const norm = stripAccents(String(text||'').trim().toLowerCase());
  return MESES_NORM.findIndex(m => norm === m || norm.startsWith(m + ' '));
}

function parseScheduleSheet(sheet, year){
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  let currentMonth = null;
  const data = [];
  const warnings = [];
  rows.forEach((row, i) => {
    const cellText = String((row && row[0]) || '').trim();
    if(!cellText) return;
    const mIdx = matchMonthHeader(cellText);
    if(mIdx >= 0){ currentMonth = mIdx; return; }
    const m = cellText.match(SHIFT_LINE_RE);
    if(!m){ warnings.push(`Linha ${i+1} não reconhecida: "${cellText}"`); return; }
    if(currentMonth === null){ warnings.push(`Linha ${i+1} ("${cellText}") ignorada: nenhum mês identificado antes dela.`); return; }

    const day1 = parseInt(m[1], 10), day2 = parseInt(m[2], 10);
    const titular = m[3].trim();
    const backup = m[4] ? m[4].trim() : null;
    const satYear = parseInt(year, 10);
    const sabadoDate = new Date(satYear, currentMonth, day1);
    let domMonth = currentMonth, domYear = satYear;
    if(day2 < day1){ domMonth += 1; if(domMonth > 11){ domMonth = 0; domYear += 1; } }
    const domingoDate = new Date(domYear, domMonth, day2);

    data.push({
      sabado: isoFrom(sabadoDate.getFullYear(), sabadoDate.getMonth(), sabadoDate.getDate()),
      domingo: isoFrom(domingoDate.getFullYear(), domingoDate.getMonth(), domingoDate.getDate()),
      titular, backup, raw: cellText, feriados: [], tem_feriado: false
    });
  });
  return { data, warnings };
}

function parseFlexibleDate(s){
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return `${m[1]}-${pad2(parseInt(m[2],10))}-${pad2(parseInt(m[3],10))}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return `${m[3]}-${pad2(parseInt(m[2],10))}-${pad2(parseInt(m[1],10))}`;
  return null;
}

function parseHolidaySheet(sheet){
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const holidays = {};
  rows.forEach((row, i) => {
    if(i === 0) return; // linha de cabeçalho: Data | Nome | Categoria
    const rawDate = String((row && row[0]) || '').trim();
    const nome = String((row && row[1]) || '').trim();
    const categoria = String((row && row[2]) || '').trim() || 'nacional';
    if(!rawDate || !nome) return;
    const iso = parseFlexibleDate(rawDate);
    if(iso) holidays[iso] = { nome, categoria };
  });
  return holidays;
}

function applyHolidayWindow(data, holidays){
  data.forEach(rec => {
    const sab = new Date(rec.sabado+'T00:00:00');
    const dom = new Date(rec.domingo+'T00:00:00');
    const sexta = new Date(sab); sexta.setDate(sab.getDate()-1);
    const segunda = new Date(dom); segunda.setDate(dom.getDate()+1);
    const janela = [sexta, sab, dom, segunda].map(d => isoFrom(d.getFullYear(), d.getMonth(), d.getDate()));
    const feriados = [];
    janela.forEach(iso => {
      if(holidays[iso] && !feriados.some(f => f.data === iso)){
        feriados.push({ data: iso, nome: holidays[iso].nome, categoria: holidays[iso].categoria });
      }
    });
    rec.feriados = feriados;
    rec.tem_feriado = feriados.length > 0;
  });
}

let importState = { year: null, workbook: null, parsed: null };

function openImportModal(){
  importState = { year: null, workbook: null, parsed: null };
  document.getElementById('importOverlay').classList.add('show');
  buildImportModal();
}
function closeImportModal(){
  document.getElementById('importOverlay').classList.remove('show');
}
document.getElementById('importOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'importOverlay') closeImportModal();
});

function buildImportModal(){
  const box = document.getElementById('importBox');
  const parsed = importState.parsed;
  const previewHtml = parsed ? `
    <div class="current-override-box">
      <b>${parsed.data.length}</b> plantão(ões) encontrado(s) para o ano <b>${importState.year}</b>${parsed.holidayCount ? `, <b>${parsed.holidayCount}</b> feriado(s) carregado(s)` : ', sem aba de feriados (esse ano fica sem marcação de feriado)'}.
      ${parsed.warnings.length ? `<div style="margin-top:6px; color:var(--holiday);">${parsed.warnings.length} linha(s) ignorada(s):<br>${parsed.warnings.slice(0,8).map(w=>'· '+w).join('<br>')}${parsed.warnings.length>8?'<br>…':''}</div>` : ''}
    </div>` : '';

  box.innerHTML = `
    <h3>Importar planilha de plantão</h3>
    <div class="modal-sub">Sobe um .xlsx com uma aba "PLANTÃO &lt;ano&gt;" no mesmo formato de hoje (ex: "10 e 11: Pedro (+ Edvaldo)", com o mês do grupo em uma linha acima). Uma aba opcional "Feriados" (colunas Data | Nome | Categoria) marca os feriados daquele ano. Isso <b>substitui por completo</b> a escala do ano identificado — os demais anos continuam intactos.</div>

    <label class="field-label">Arquivo (.xlsx)</label>
    <input type="file" id="importFileInput" accept=".xlsx,.xls">

    <label class="field-label">Ano (preencha se a aba não tiver o ano no nome)</label>
    <input type="text" id="importYearInput" placeholder="ex: 2027" value="${importState.year || ''}">

    ${previewHtml}

    <div class="modal-actions">
      <div></div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" id="importCancelBtn">cancelar</button>
        <button class="btn btn-primary" id="importConfirmBtn" ${!parsed || parsed.data.length===0 ? 'disabled' : ''}>substituir escala do ano</button>
      </div>
    </div>
  `;

  box.querySelector('#importFileInput').addEventListener('change', handleImportFile);
  box.querySelector('#importYearInput').addEventListener('input', (e) => {
    importState.year = e.target.value.trim() || null;
  });
  box.querySelector('#importCancelBtn').addEventListener('click', closeImportModal);
  const confirmBtn = box.querySelector('#importConfirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click', confirmImport);
}

function handleImportFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try{
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      importState.workbook = wb;

      let scheduleSheetName = wb.SheetNames.find(n => /plant[ãa]o/i.test(n));
      let yearFromName = null;
      if(scheduleSheetName){
        const ym = scheduleSheetName.match(/(\d{4})/);
        if(ym) yearFromName = ym[1];
      }
      if(!scheduleSheetName && wb.SheetNames.length === 1) scheduleSheetName = wb.SheetNames[0];
      const year = importState.year || yearFromName;
      if(!scheduleSheetName || !year){
        showImportError('Não consegui identificar a aba da escala e/ou o ano. Renomeie a aba para algo como "PLANTÃO 2027" ou informe o ano no campo acima.');
        return;
      }
      importState.year = String(year);

      const holidaySheetName = wb.SheetNames.find(n => /feriad/i.test(n));
      const holidays = holidaySheetName ? parseHolidaySheet(wb.Sheets[holidaySheetName]) : {};

      const { data, warnings } = parseScheduleSheet(wb.Sheets[scheduleSheetName], importState.year);
      applyHolidayWindow(data, holidays);

      importState.parsed = { data, warnings, holidays, holidayCount: Object.keys(holidays).length };
      buildImportModal();
    }catch(err){
      showImportError('Erro ao ler o arquivo: ' + (err && err.message ? err.message : err));
    }
  };
  reader.readAsArrayBuffer(file);
}

function showImportError(msg){
  const box = document.getElementById('importBox');
  let el = box.querySelector('.modal-error');
  if(!el){
    el = document.createElement('div');
    el.className = 'modal-error';
    el.style.cssText = 'color:var(--today); font-size:11px; margin-top:10px;';
    box.querySelector('.modal-actions').before(el);
  }
  el.textContent = '⚠ ' + msg;
}

async function confirmImport(){
  const parsed = importState.parsed;
  const year = importState.year;
  if(!parsed || !year) return;
  const result = await apiSaveSchedule(year, parsed.data, parsed.holidays);
  if(!result.ok){
    showImportError(result.error);
    return;
  }
  currentYear = String(year);
  fireConfetti();
  closeImportModal();
  renderAll();
}

// ---- Geração de novo ano (mesmo padrão de rodízio) ----
function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(rng()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
// Preenche `count` posições repetindo ciclos embaralhados do roster (cada
// pessoa aparece o mesmo número de vezes por ciclo), evitando repetição
// imediata na fronteira entre dois ciclos.
function shuffledCycleFill(roster, count, rng){
  const out = [];
  let guard = 0;
  while(out.length < count && guard < 1000){
    guard++;
    let cycle = shuffle(roster, rng);
    if(out.length > 0 && cycle[0] === out[out.length-1]){
      const idx = cycle.findIndex((p,i) => i>0 && p !== out[out.length-1]);
      if(idx > 0){ const tmp = cycle[0]; cycle[0] = cycle[idx]; cycle[idx] = tmp; }
    }
    out.push(...cycle);
  }
  return out.slice(0, count);
}
function addDays(date, days){
  const d = new Date(date);
  d.setDate(d.getDate()+days);
  return d;
}
function firstSaturdayOnOrAfter(date){
  const d = new Date(date);
  while(d.getDay() !== 6) d.setDate(d.getDate()+1);
  return d;
}
// Algoritmo de Meeus/Jones/Butcher para domingo de Páscoa (calendário gregoriano).
function computeEaster(year){
  const a = year % 19;
  const b = Math.floor(year/100);
  const c = year % 100;
  const d = Math.floor(b/4);
  const e = b % 4;
  const f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c/4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l)/451);
  const total = h + l - 7*m + 114;
  const month = Math.floor(total/31); // 3=março, 4=abril (1-indexado)
  const day = (total % 31) + 1;
  return new Date(year, month-1, day);
}
// Feriados nacionais/estaduais(SP)/municipais(Jacareí, SJC) considerados no
// painel, recalculados para qualquer ano (fixos + móveis via Páscoa).
function computeBrazilianHolidays(year){
  const easter = computeEaster(year);
  const holidays = {};
  const add = (date, nome, categoria) => {
    holidays[isoFrom(date.getFullYear(), date.getMonth(), date.getDate())] = { nome, categoria };
  };
  add(new Date(year,0,1), 'Confraternização Universal', 'nacional');
  add(addDays(easter,-48), 'Carnaval (segunda)', 'facultativo');
  add(addDays(easter,-47), 'Carnaval (terça)', 'facultativo');
  add(addDays(easter,-46), 'Quarta-feira de Cinzas (até 14h)', 'facultativo');
  add(addDays(easter,-2), 'Sexta-feira Santa', 'nacional');
  add(new Date(year,3,21), 'Tiradentes', 'nacional');
  add(new Date(year,4,1), 'Dia do Trabalho', 'nacional');
  add(addDays(easter,60), 'Corpus Christi', 'facultativo');
  add(new Date(year,6,9), 'Revolução Constitucionalista', 'estadual-SP');
  add(new Date(year,8,7), 'Independência do Brasil', 'nacional');
  add(new Date(year,9,12), 'Nossa Senhora Aparecida', 'nacional');
  add(new Date(year,10,2), 'Finados', 'nacional');
  add(new Date(year,10,15), 'Proclamação da República', 'nacional');
  add(new Date(year,10,20), 'Consciência Negra', 'nacional/estadual-SP');
  add(new Date(year,11,8), 'Dia da Padroeira de Jacareí (N. Sra. Conceição)', 'municipal-Jacareí');
  add(new Date(year,11,25), 'Natal', 'nacional');
  add(new Date(year,2,19), 'Dia de São José (Padroeiro de SJC)', 'municipal-SJC');
  add(new Date(year,6,27), 'Aniversário de São José dos Campos', 'municipal-SJC');
  return holidays;
}
function defaultBackupPool(){
  const set = new Set();
  DATA_2026.forEach(r => { if(r.backup) set.add(r.backup); });
  return [...set];
}
// Gera uma escala de sábados/domingos para `year` com rodízio equilibrado
// entre `titulares` e backup na mesma proporção observada em 2026.
function generateYearSchedule(year, titulares, backups){
  const rng = mulberry32(year * 7919 + 13);
  const start = firstSaturdayOnOrAfter(new Date(year,0,1));
  const saturdays = [];
  let d = new Date(start);
  while(d.getFullYear() === year){
    saturdays.push(new Date(d));
    d = addDays(d,7);
  }
  const n = saturdays.length;
  const titularSeq = shuffledCycleFill(titulares, n, rng);

  // Backup: no máximo 1 plantão de backup por pessoa por mês — regra da
  // equipe (assistentes, ex. Edvaldo/Randal, nunca dobram no mesmo mês).
  // Por isso a escolha é feita mês a mês, nunca com o pool do ano inteiro.
  let backupSeq = new Array(n).fill(null);
  if(backups && backups.length > 0){
    const refBackupRatio = DATA_2026.filter(r => r.backup).length / DATA_2026.length;
    const byMonth = {};
    saturdays.forEach((sat, idx) => {
      const mk = sat.getMonth();
      (byMonth[mk] = byMonth[mk] || []).push(idx);
    });
    Object.values(byMonth).forEach(idxs => {
      const wantedThisMonth = Math.min(Math.round(idxs.length * refBackupRatio), backups.length);
      const shuffledIdx = shuffle(idxs, rng);
      const shuffledBackups = shuffle(backups, rng);
      for(let i=0; i<wantedThisMonth; i++){
        backupSeq[shuffledIdx[i]] = shuffledBackups[i];
      }
    });
  }

  const holidays = computeBrazilianHolidays(year);
  const data = saturdays.map((sat, idx) => {
    const dom = addDays(sat,1);
    const titular = titularSeq[idx];
    let backup = backupSeq[idx];
    if(backup === titular) backup = null;
    const raw = `${pad2(sat.getDate())} e ${pad2(dom.getDate())}: ${titular}${backup ? ` (+ ${backup})` : ''}`;
    return {
      sabado: isoFrom(sat.getFullYear(), sat.getMonth(), sat.getDate()),
      domingo: isoFrom(dom.getFullYear(), dom.getMonth(), dom.getDate()),
      titular, backup, raw, feriados: [], tem_feriado: false
    };
  });
  applyHolidayWindow(data, holidays);
  return { data, holidays };
}

let generateState = { year: null, titulares: '', backups: '', preview: null };

function openGenerateModal(){
  const years = availableYears().map(y => parseInt(y,10));
  const nextYear = String((years.length ? Math.max(...years) : new Date().getFullYear()) + 1);
  generateState = {
    year: nextYear,
    titulares: TITULARES.join(', '),
    backups: defaultBackupPool().join(', '),
    preview: null
  };
  document.getElementById('generateOverlay').classList.add('show');
  buildGenerateModal();
}
function closeGenerateModal(){
  document.getElementById('generateOverlay').classList.remove('show');
}
document.getElementById('generateOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'generateOverlay') closeGenerateModal();
});

function buildGenerateModal(){
  const box = document.getElementById('generateBox');
  const preview = generateState.preview;
  const previewHtml = preview ? `
    <div class="current-override-box">
      <b>${preview.data.length}</b> plantões gerados para <b>${generateState.year}</b>.<br>
      Distribuição: ${Object.entries(preview.counts).map(([n,c]) => `${n}: ${c}`).join(' · ')}
    </div>` : '';

  box.innerHTML = `
    <h3>Gerar escala de um novo ano</h3>
    <div class="modal-sub">Gera uma escala seguindo o mesmo padrão usado em 2026: rodízio equilibrado entre os titulares, backup alternado na mesma proporção, e feriados nacionais/estaduais(SP)/municipais calculados automaticamente. Isso <b>substitui por completo</b> a escala do ano informado.</div>

    <label class="field-label">Ano</label>
    <input type="text" id="genYearInput" value="${generateState.year}">

    <label class="field-label">Titulares (separados por vírgula)</label>
    <input type="text" id="genTitularesInput" value="${generateState.titulares}">

    <label class="field-label">Backups (separados por vírgula, opcional)</label>
    <input type="text" id="genBackupsInput" value="${generateState.backups}">

    ${previewHtml}

    <div class="modal-actions">
      <div></div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" id="genCancelBtn">cancelar</button>
        <button class="btn btn-ghost" id="genPreviewBtn">pré-visualizar</button>
        <button class="btn btn-primary" id="genConfirmBtn" ${!preview ? 'disabled' : ''}>salvar escala</button>
      </div>
    </div>
  `;

  box.querySelector('#genYearInput').addEventListener('input', (e) => {
    generateState.year = e.target.value.trim();
    generateState.preview = null;
  });
  box.querySelector('#genTitularesInput').addEventListener('input', (e) => {
    generateState.titulares = e.target.value;
  });
  box.querySelector('#genBackupsInput').addEventListener('input', (e) => {
    generateState.backups = e.target.value;
  });
  box.querySelector('#genCancelBtn').addEventListener('click', closeGenerateModal);
  box.querySelector('#genPreviewBtn').addEventListener('click', () => {
    const titulares = generateState.titulares.split(',').map(s => s.trim()).filter(Boolean);
    const backups = generateState.backups.split(',').map(s => s.trim()).filter(Boolean);
    const year = parseInt(generateState.year, 10);
    if(!year || titulares.length < 2){
      showGenerateError('Informe um ano válido e ao menos 2 titulares.');
      return;
    }
    const { data, holidays } = generateYearSchedule(year, titulares, backups);
    const counts = {};
    data.forEach(r => { counts[r.titular] = (counts[r.titular]||0) + 1; });
    generateState.preview = { data, holidays, counts };
    buildGenerateModal();
  });
  const confirmBtn = box.querySelector('#genConfirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click', confirmGenerate);
}
