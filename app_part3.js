function renderPersonFilter(){
  const sel = document.getElementById('personFilter');
  const names = [...new Set([...ALL_PEOPLE, ...getEffectiveData().flatMap(r => [r.titular, r.backup]).filter(Boolean)])];
  sel.innerHTML = '<option value="">todos</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
  sel.value = tableFilterPerson;
  sel.onchange = () => { tableFilterPerson = sel.value; renderTable(); };
}

document.getElementById('onlyHoliday').addEventListener('change', (e) => {
  onlyHoliday = e.target.checked;
  renderAll();
});

let modalState = { key: null, role: 'titular', chosen: null };

function monthKey(iso){ return iso.slice(0,7); }

function suggestReplacements(rec, role){
  const counts = computeCounts();
  const absent = role === 'titular' ? rec.titular : rec.backup;
  const other = role === 'titular' ? rec.backup : rec.titular;

  const recommended = [];
  // Só recomenda "promover" o backup a titular se essa pessoa puder ser
  // titular — um assistente (Edvaldo, Randal) nunca assume o plantão sozinho.
  if(role === 'titular' && rec.backup && podeSerTitular(rec.backup)){
    recommended.push(rec.backup);
  }

  const pool = ALL_PEOPLE.filter(p =>
    p !== absent && p !== other && !recommended.includes(p) &&
    (role !== 'titular' || podeSerTitular(p)) &&
    (role !== 'backup' || podeSerBackupNesteMes(p, rec.sabado, rec.sabado))
  );
  const ranked = pool.slice().sort((a,b) => {
    const ca = counts[a]?.titular || 0, cb = counts[b]?.titular || 0;
    if(ca !== cb) return ca - cb;
    return (counts[a]?.titular_fer||0) - (counts[b]?.titular_fer||0);
  });

  return { recommended, ranked };
}

function shiftsInMonth(name, iso){
  const mk = monthKey(iso);
  return getEffectiveData().filter(r => r.titular === name && monthKey(r.sabado) === mk).length;
}

// Quantos plantões como BACKUP essa pessoa já tem no mesmo mês do plantão
// "iso" (excluindo o próprio plantão em edição, se ele já for dela).
function backupShiftsInMonth(name, iso, excludeSabado){
  const mk = monthKey(iso);
  return getEffectiveData().filter(r => r.backup === name && monthKey(r.sabado) === mk && r.sabado !== excludeSabado).length;
}

// Assistentes (Edvaldo, Randal) só podem fazer 1 backup por mês cada um —
// nunca dobrar no mesmo mês. Titulares que eventualmente façam backup não
// têm esse teto.
function podeSerBackupNesteMes(name, iso, excludeSabado){
  if(podeSerTitular(name)) return true; // regra é só para assistentes
  return backupShiftsInMonth(name, iso, excludeSabado) === 0;
}

function openSwapModal(shiftKey){
  const rec = getEffectiveData().find(r => r.sabado === shiftKey);
  if(!rec) return;
  const role = 'titular';
  modalState = { key: shiftKey, role, chosen: null };
  const { recommended, ranked } = suggestReplacements(rec, role);
  modalState.chosen = recommended[0] || ranked[0] || null;
  buildModal();
  document.getElementById('modalOverlay').classList.add('show');
}
function closeModal(){
  document.getElementById('modalOverlay').classList.remove('show');
}

function buildModal(){
  const rec = getEffectiveData().find(r => r.sabado === modalState.key);
  const box = document.getElementById('modalBox');
  const role = modalState.role;
  const currentPerson = role === 'titular' ? rec.titular : rec.backup;
  const counts = computeCounts();

  const { recommended, ranked } = suggestReplacements(rec, role);

  const pillHtml = (name, tag) => {
    const c = counts[name] || {titular:0};
    const extra = shiftsInMonth(name, rec.sabado);
    const chosenCls = modalState.chosen === name ? ' chosen' : '';
    const recCls = tag ? ' recommended' : '';
    const warn = extra > 0 ? ` <span class="cnt" style="color:var(--holiday)">· já tem ${extra} em ${MESES_PT_LONG[new Date(rec.sabado+'T00:00:00').getMonth()]}</span>` : '';
    return `<button class="suggestion-pill${chosenCls}${recCls}" data-name="${name}">
      ${tag ? `<span class="rec-tag">★</span>` : ''}${name}
      <span class="cnt">${c.titular||0} plantões${warn}</span>
    </button>`;
  };

  const overrideBox = rec._override ? `
    <div class="current-override-box">
      Este plantão já foi trocado: era <b>${rec._override.original_titular}${rec._override.original_backup ? ' + '+rec._override.original_backup : ''}</b>.
      ${rec._override.motivo ? `Motivo: ${rec._override.motivo}.` : ''}
    </div>` : '';

  const anyPersonOptions = ALL_PEOPLE.filter(p =>
    p !== currentPerson && p !== (role==='titular'?rec.backup:rec.titular) &&
    (role !== 'titular' || podeSerTitular(p)) &&
    (role !== 'backup' || podeSerBackupNesteMes(p, rec.sabado, rec.sabado))
  );

  box.innerHTML = `
    <h3>${fmtDateFull(rec.sabado)} – ${fmtDateFull(rec.domingo)}</h3>
    <div class="modal-sub">Titular atual: <b style="color:${PERSON_COLOR_HEX[rec.titular]||'#fff'}">${rec.titular}</b>${rec.backup ? ` · Backup atual: <b>${rec.backup}</b>` : ' · sem backup neste plantão'}</div>

    ${overrideBox}

    <div class="role-toggle">
      <button data-role="titular" class="${role==='titular'?'active':''}">quem sai é o titular</button>
      <button data-role="backup" class="${role==='backup'?'active':''}" ${!rec.backup ? 'disabled style="opacity:.4;cursor:not-allowed;"' : ''}>quem sai é o backup</button>
    </div>

    <label class="field-label">Sugestão (sem sobrecarregar ninguém)</label>
    <div class="suggestion-list">
      ${recommended.map(n => pillHtml(n, true)).join('')}
      ${ranked.slice(0,5).map(n => pillHtml(n, false)).join('')}
    </div>

    <label class="field-label">Ou escolha qualquer pessoa (use esta opção para incluir um plantão extra)</label>
    <select id="anyPersonSelect">
      <option value="">— selecionar —</option>
      ${anyPersonOptions.map(p => `<option value="${p}" ${modalState.chosen===p?'selected':''}>${p}</option>`).join('')}
      <option value="__new__">+ pessoa nova...</option>
    </select>
    ${role === 'titular' ? `<div class="hint">Assistentes (Edvaldo, Randal) não aparecem aqui — eles só cobrem como backup, nunca sozinhos.</div>` : ''}
    ${role === 'backup' ? `<div class="hint">Edvaldo e Randal que já têm 1 backup neste mês não aparecem aqui — no máximo 1 por mês para cada um.</div>` : ''}
    <div id="newNameWrap" style="display:none; margin-top:8px;">
      <input type="text" id="newNameInput" placeholder="Nome da pessoa">
    </div>

    <label class="field-label">Motivo (opcional)</label>
    <input type="text" id="motivoInput" placeholder="ex: férias, atestado" value="${rec._override?.motivo || ''}">

    <div class="modal-actions">
      <div>
        ${rec._override ? `<button class="btn btn-danger" id="restoreBtn">restaurar original</button>` : ''}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" id="cancelBtn">cancelar</button>
        <button class="btn btn-primary" id="saveBtn" ${!modalState.chosen ? 'disabled' : ''}>salvar troca</button>
      </div>
    </div>
  `;

  box.querySelectorAll('.role-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      if(btn.disabled) return;
      modalState.role = btn.dataset.role;
      modalState.chosen = null;
      buildModal();
    });
  });
  box.querySelectorAll('.suggestion-pill').forEach(p => {
    p.addEventListener('click', () => { modalState.chosen = p.dataset.name; buildModal(); });
  });
  const sel = box.querySelector('#anyPersonSelect');
  sel.addEventListener('change', () => {
    if(sel.value === '__new__'){
      box.querySelector('#newNameWrap').style.display = 'block';
      modalState.chosen = null;
    } else {
      modalState.chosen = sel.value || null;
      box.querySelector('#newNameWrap').style.display = 'none';
    }
  });
  const newNameInput = box.querySelector('#newNameInput');
  if(newNameInput){
    newNameInput.addEventListener('input', () => { modalState.chosen = newNameInput.value.trim() || null; });
  }
  box.querySelector('#cancelBtn').addEventListener('click', closeModal);
  box.querySelector('#saveBtn').addEventListener('click', applySwap);
  const restoreBtn = box.querySelector('#restoreBtn');
  if(restoreBtn) restoreBtn.addEventListener('click', restoreOriginal);
}

function fireConfetti(){
  if(typeof confetti === 'function'){
    confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.25 },
      colors: ['#0327A5', '#FA5E01', '#0D9488', '#7C3AED', '#DB2777']
    });
  }
}

async function applySwap(){
  const rec = getEffectiveData().find(r => r.sabado === modalState.key);
  const box = document.getElementById('modalBox');
  const motivo = box.querySelector('#motivoInput').value.trim();
  const chosen = modalState.chosen;
  if(!chosen){ return; }

  const base = curData().find(r => r.sabado === modalState.key);
  const existing = curOverrides()[modalState.key];

  let newTitular = rec.titular;
  let newBackup = rec.backup;
  if(modalState.role === 'titular') newTitular = chosen;
  else newBackup = chosen;

  const candidate = { ...curOverrides() };
  candidate[modalState.key] = {
    titular: newTitular,
    backup: newBackup,
    motivo: motivo || (existing ? existing.motivo : ''),
    original_titular: existing ? existing.original_titular : base.titular,
    original_backup: existing ? existing.original_backup : base.backup,
    ts: Date.now()
  };

  const result = await apiSaveOverridesForCurrentYear(candidate);
  if(!result.ok){
    showModalError(result.error);
    return;
  }
  fireConfetti();
  closeModal();
  renderAll();
}

async function restoreOriginal(){
  const candidate = { ...curOverrides() };
  delete candidate[modalState.key];
  const result = await apiSaveOverridesForCurrentYear(candidate);
  if(!result.ok){
    showModalError(result.error);
    return;
  }
  closeModal();
  renderAll();
}

function showModalError(msg){
  const box = document.getElementById('modalBox');
  let el = box.querySelector('.modal-error');
  if(!el){
    el = document.createElement('div');
    el.className = 'modal-error';
    el.style.cssText = 'color:var(--today); font-size:11px; margin-top:10px;';
    box.querySelector('.modal-actions').before(el);
  }
  el.textContent = '⚠ ' + msg;
}

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'modalOverlay') closeModal();
});

let replaceState = { from: null, to: null, toIsNew: false, mode: null };

function futureShiftsOf(person){
  const TODAY = getToday();
  return getEffectiveData().filter(rec => {
    if(new Date(rec.domingo+'T00:00:00') < TODAY) return false;
    return rec.titular === person || rec.backup === person;
  });
}

function peopleWithFutureShifts(){
  const set = new Set();
  getEffectiveData().forEach(rec => {
    if(new Date(rec.domingo+'T00:00:00') < getToday()) return;
    if(rec.titular) set.add(rec.titular);
    if(rec.backup) set.add(rec.backup);
  });
  return [...set];
}

function openReplaceModal(){
  replaceState = { from: null, to: null, toIsNew: false, mode: null };
  document.getElementById('replaceOverlay').classList.add('show');
  buildReplaceModal();
}
function closeReplaceModal(){
  document.getElementById('replaceOverlay').classList.remove('show');
}
document.getElementById('replaceOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'replaceOverlay') closeReplaceModal();
});

function buildReplaceModal(){
  const box = document.getElementById('replaceBox');
  const candidates = peopleWithFutureShifts();
  const affected = replaceState.from ? futureShiftsOf(replaceState.from) : [];
  // Se quem sai tem plantão como titular, quem assume também precisa poder
  // ser titular — assistentes (Edvaldo, Randal) ficam de fora da lista.
  const fromIsTitular = affected.some(r => r.titular === replaceState.from);

  box.innerHTML = `
    <h3>Substituir funcionário</h3>
    <div class="modal-sub">Funcionário desligado, novo funcionário assume automaticamente todos os plantões futuros dele (a partir de hoje). Plantões já cumpridos ficam registrados como estavam.</div>

    <label class="field-label">Funcionário que saiu</label>
    <select id="replaceFromSelect">
      <option value="">— selecionar —</option>
      ${candidates.map(p => `<option value="${p}" ${replaceState.from===p?'selected':''}>${p}</option>`).join('')}
    </select>

    ${replaceState.from ? `<div class="modal-sub" style="margin-top:6px;">${affected.length===0 ? 'Nenhum plantão futuro encontrado para essa pessoa.' : `<b>${affected.length}</b> plantão(ões) futuro(s) será(ão) transferido(s).`}</div>` : ''}

    <label class="field-label" style="margin-top:12px;">Novo funcionário</label>
    <select id="replaceToSelect">
      <option value="">— selecionar —</option>
      ${ALL_PEOPLE.filter(p => p !== replaceState.from && (!fromIsTitular || podeSerTitular(p))).map(p => `<option value="${p}" ${replaceState.to===p?'selected':''}>${p}</option>`).join('')}
      <option value="__new__" ${replaceState.toIsNew ? 'selected' : ''}>+ pessoa nova...</option>
      <option value="__redistribute__" ${replaceState.mode==='redistribute' ? 'selected' : ''}>— não contratar (redistribuir entre a equipe) —</option>
    </select>
    ${fromIsTitular ? `<div class="hint">${replaceState.from} é titular — assistentes (Edvaldo, Randal) não aparecem aqui, pois não assumem plantão sozinhos. Escolha outro titular, cadastre uma pessoa nova, ou redistribua entre a equipe.</div>` : ''}
    <div id="replaceNewNameWrap" style="display:${replaceState.toIsNew ? 'block' : 'none'}; margin-top:8px;">
      <input type="text" id="replaceNewNameInput" placeholder="Nome da pessoa" value="${replaceState.toIsNew ? (replaceState.to || '') : ''}">
    </div>
    ${replaceState.mode==='redistribute' ? `<div class="modal-sub" style="margin-top:8px;">Os plantões como titular serão redistribuídos entre o restante dos titulares (assistentes não entram nessa conta), dando preferência a quem tem menos plantões no ano — ou seja, os titulares que ficarem vão precisar cobrir mais finais de semana. Plantões em que ${replaceState.from} era só backup ficam sem backup.</div>` : ''}

    <label class="field-label">Motivo (opcional)</label>
    <input type="text" id="replaceMotivoInput" placeholder="ex: desligamento, saída da empresa">

    <div class="modal-actions">
      <div></div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" id="replaceCancelBtn">cancelar</button>
        <button class="btn btn-primary" id="replaceConfirmBtn" ${(!replaceState.from || (replaceState.mode!=='redistribute' && !replaceState.to) || affected.length===0) ? 'disabled' : ''}>${replaceState.mode==='redistribute' ? 'redistribuir plantões' : 'substituir'}</button>
      </div>
    </div>
  `;

  box.querySelector('#replaceFromSelect').addEventListener('change', (e) => {
    replaceState.from = e.target.value || null;
    buildReplaceModal();
  });
  const toSel = box.querySelector('#replaceToSelect');
  toSel.addEventListener('change', () => {
    if(toSel.value === '__new__'){
      replaceState.toIsNew = true;
      replaceState.mode = null;
      replaceState.to = null;
    } else if(toSel.value === '__redistribute__'){
      replaceState.toIsNew = false;
      replaceState.mode = 'redistribute';
      replaceState.to = null;
    } else {
      replaceState.toIsNew = false;
      replaceState.mode = null;
      replaceState.to = toSel.value || null;
    }
    buildReplaceModal();
    if(replaceState.toIsNew){
      const input = box.querySelector('#replaceNewNameInput');
      if(input) input.focus();
    }
  });
  const newNameInput = box.querySelector('#replaceNewNameInput');
  if(newNameInput){
    newNameInput.addEventListener('input', () => {
      replaceState.to = newNameInput.value.trim() || null;
      box.querySelector('#replaceConfirmBtn').disabled = (!replaceState.from || !replaceState.to || affected.length===0);
    });
  }
  box.querySelector('#replaceCancelBtn').addEventListener('click', closeReplaceModal);
  const confirmBtn = box.querySelector('#replaceConfirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click', applyReplacement);
}

async function applyReplacement(){
  const box = document.getElementById('replaceBox');
  const from = replaceState.from;
  const to = replaceState.to;
  const isRedistribute = replaceState.mode === 'redistribute';
  const motivo = box.querySelector('#replaceMotivoInput').value.trim();
  if(!from) return;
  if(!isRedistribute && (!to || from === to)) return;

  const TODAY = getToday();
  const yearOverrides = curOverrides();
  const candidate = { ...yearOverrides };
  let count = 0;

  // Redistribuição: escolhe, para cada plantão em que "from" era titular, quem
  // da equipe restante está com menos plantões no ano até agora (empate por
  // menos feriados), simulando o mesmo critério de justiça usado nas trocas
  // individuais — sem repetir a mesma pessoa que já é backup naquele plantão.
  // Assistentes (Edvaldo, Randal) ficam fora do sorteio: eles não assumem
  // plantão sozinhos, então essas vagas só circulam entre os titulares.
  let pool = null;
  let runningTitular = null;
  let runningFer = null;
  if(isRedistribute){
    pool = peopleWithFutureShifts().filter(p => p !== from && podeSerTitular(p));
    if(pool.length === 0){
      showReplaceError('Não há mais nenhum titular disponível para redistribuir os plantões.');
      return;
    }
    const baseCounts = computeCounts();
    runningTitular = {};
    runningFer = {};
    pool.forEach(p => {
      runningTitular[p] = baseCounts[p]?.titular || 0;
      runningFer[p] = baseCounts[p]?.titular_fer || 0;
    });
  }
  function pickRedistributed(effBackup, temFeriado){
    const opts = pool.filter(p => p !== effBackup);
    const chooseFrom = opts.length ? opts : pool;
    chooseFrom.sort((a,b) => (runningTitular[a]-runningTitular[b]) || (runningFer[a]-runningFer[b]));
    const chosen = chooseFrom[0];
    runningTitular[chosen]++;
    if(temFeriado) runningFer[chosen]++;
    return chosen;
  }

  curData().forEach(base => {
    if(new Date(base.domingo+'T00:00:00') < TODAY) return; // já cumprido: mantém como está
    const existing = yearOverrides[base.sabado];
    const effTitular = existing ? existing.titular : base.titular;
    const effBackup = existing ? existing.backup : base.backup;
    if(effTitular !== from && effBackup !== from) return;

    let newTitular = effTitular;
    let newBackup = effBackup;
    if(effTitular === from){
      newTitular = isRedistribute ? pickRedistributed(effBackup, base.tem_feriado) : to;
    }
    if(effBackup === from){
      newBackup = isRedistribute ? null : to;
    }

    candidate[base.sabado] = {
      titular: newTitular,
      backup: newBackup,
      motivo: motivo || (isRedistribute ? `${from} saiu — plantão redistribuído entre os titulares` : `Substituição de funcionário: ${from} → ${to}`),
      original_titular: existing ? existing.original_titular : base.titular,
      original_backup: existing ? existing.original_backup : base.backup,
      ts: Date.now()
    };
    count++;
  });

  if(count === 0){
    showReplaceError('Nenhum plantão futuro encontrado para essa pessoa.');
    return;
  }

  const result = await apiSaveOverridesForCurrentYear(candidate);
  if(!result.ok){
    showReplaceError(result.error);
    return;
  }
  fireConfetti();
  closeReplaceModal();
  renderAll();
  // Confirmação explícita da quantidade — evita dúvida sobre se foi só 1
  // plantão ou todos os futuros que mudaram de mão.
  alert(`✅ ${count} plantão(ões) futuro(s) de ${from} foram ${isRedistribute ? 'redistribuídos entre os titulares' : `transferidos para ${to}`}.`);
}

function showReplaceError(msg){
  const box = document.getElementById('replaceBox');
  let el = box.querySelector('.modal-error');
  if(!el){
    el = document.createElement('div');
    el.className = 'modal-error';
    el.style.cssText = 'color:var(--today); font-size:11px; margin-top:10px;';
    box.querySelector('.modal-actions').before(el);
  }
  el.textContent = '⚠ ' + msg;
}

function renderHistory(){
  const list = document.getElementById('historyList');
  const section = document.getElementById('historySection');
  const entries = Object.entries(curOverrides()).sort((a,b) => b[1].ts - a[1].ts);
  if(entries.length === 0){
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  list.innerHTML = entries.map(([key, o]) => {
    const rec = curData().find(r => r.sabado === key);
    return `<div class="history-row">
      <div>${fmtDateFull(rec.sabado)}–${fmtDateFull(rec.domingo)}: era <b>${o.original_titular}${o.original_backup?' + '+o.original_backup:''}</b> → agora <b>${o.titular}${o.backup?' + '+o.backup:''}</b>${o.motivo ? ' · '+o.motivo : ''}</div>
      <button class="btn btn-ghost" data-key="${key}">desfazer</button>
    </div>`;
  }).join('');
  list.querySelectorAll('button[data-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const candidate = { ...curOverrides() };
      delete candidate[btn.dataset.key];
      const result = await apiSaveOverridesForCurrentYear(candidate);
      if(!result.ok){
        alert('⚠ ' + result.error);
        return;
      }
      renderAll();
    });
  });
}
