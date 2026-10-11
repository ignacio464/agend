'use strict';
/* Interfaz. Todo el texto del usuario se inserta con textContent / nodos de texto (nunca innerHTML). */
(function () {
  const C = window.Core;
  const KEY = 'colocaciones.v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  let S = null;
  let storageOk = true;
  let ctx = {};
  const filters = { estado: 'todas', desde: '', hasta: '' };
  let chartMode = 'semana';
  const calc = { monto: '', tipo: 'mensual', tasa: '', plazo: '', modo: 'simple', ciclos: '1', inicio: '', comparar: false, tipo2: 'mensual', tasa2: '' };

  /* ---------- utilidades DOM ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'value') value = v;
        else if (k === 'checked' || k === 'disabled') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }
  const $ = (s) => document.querySelector(s);
  function svg(tag, attrs, text) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
  }
  function modal(build, onDismiss) {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    let closed = false;
    const close = (dismissed) => {
      if (closed) return;
      closed = true; back.remove();
      if (dismissed && onDismiss) onDismiss();
    };
    box.append(build(() => close(false)));
    back.append(box);
    back.addEventListener('click', (e) => { if (e.target === back) close(true); });
    document.body.append(back);
    const first = box.querySelector('input,select');
    if (first) first.focus();
    return close;
  }
  function ask(title, msg, okLabel, danger) {
    return new Promise((res) => {
      modal((close) => h('div', null,
        h('h2', null, title), h('p', null, msg),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); res(false); } }, 'Cancelar'),
          h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', onclick: () => { close(); res(true); } }, okLabel))), () => res(false));
    });
  }
  const money = C.fmtMoney, pct = C.fmtPct, fdate = C.fmtDate;
  const plain = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  const errBox = (list) => h('div', { class: 'err', role: 'alert' }, list.map((e) => h('p', null, e)));
  function field(label, input, hint) {
    return h('div', { class: 'field' }, h('label', null, label), input, hint ? h('div', { class: 'mute' }, hint) : null);
  }
  const textIn = (v, mode, extra) => h('input', Object.assign({ type: 'text', inputmode: mode || 'decimal', autocomplete: 'off', value: v == null ? '' : v }, extra || {}));

  /* ---------- almacenamiento ---------- */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOk = false; }
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      const v = C.validateData(o);
      if (v.ok) {
        const base = C.emptyState(C.todayStr());
        const st = o.settings || {};
        const s = base.settings;
        if (typeof st.pinHash === 'string' && typeof st.pinSalt === 'string' && Number.isInteger(st.pinLen) && st.pinLen >= 4 && st.pinLen <= 6) { s.pinHash = st.pinHash; s.pinSalt = st.pinSalt; s.pinLen = st.pinLen; }
        if (Number.isInteger(st.cycleDays) && st.cycleDays >= 1 && st.cycleDays <= 365) s.cycleDays = st.cycleDays;
        if (!isNaN(C.parseDate(st.lastBackup))) s.lastBackup = st.lastBackup;
        if (!isNaN(C.parseDate(st.createdAt))) s.createdAt = st.createdAt;
        return { version: 1, settings: s, placements: v.data.placements, movements: v.data.movements, closings: v.data.closings };
      }
    } catch (e) { /* se resguarda abajo */ }
    try { localStorage.setItem(KEY + '.corrupto', raw); } catch (e) { /* nada */ }
    setTimeout(() => toast('Los datos guardados estaban dañados; se guardó una copia aparte.'), 500);
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOk = true; } catch (e) { storageOk = false; }
    renderBanner();
  }
  function renderBanner() {
    const b = $('#banner');
    b.replaceChildren(storageOk ? '' : h('div', { class: 'alert bad' }, 'No se pueden guardar los datos en este navegador (¿modo privado o sin espacio?). Exportá un respaldo.'));
  }

  /* ---------- navegación ---------- */
  const ROUTES = { home: viewHome, form: viewForm, calc: viewCalc, more: viewMore, cierre: viewCierre };
  const TITLES = { home: 'Colocaciones', form: 'Colocación', calc: 'Calculadora', more: 'Más', cierre: 'Hacer cierre' };
  function route() { const r = location.hash.slice(1); return ROUTES[r] ? r : 'home'; }
  function go(name, c) {
    ctx = c || {};
    if (location.hash === '#' + name) render(true); else location.hash = name;
  }
  function render(reset) {
    if (!S) return;
    const name = route();
    $('#view').replaceChildren(ROUTES[name]());
    $('#title').textContent = TITLES[name];
    const navName = name === 'form' || name === 'cierre' ? (name === 'form' ? 'home' : 'more') : name;
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === navName));
    if (reset) window.scrollTo(0, 0);
  }
  const refresh = () => { const y = window.scrollY; render(false); window.scrollTo(0, y); };

  /* ---------- Inicio ---------- */
  function statCard(k, v) { return h('div', { class: 'card stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }

  function placementItem(p, today) {
    const v = C.placementView(p, today);
    const badge = p.status === 'paid' ? h('span', { class: 'badge ok' }, 'Cobrada ' + fdate(p.paidDate))
      : v.overdue ? h('span', { class: 'badge bad' }, 'Vencida, falta marcar como cobrada')
        : h('span', { class: 'badge info' }, 'En curso');
    const linked = p.linkedFrom ? S.placements.find((x) => x.id === p.linkedFrom) : null;
    const acts = [];
    if (p.status === 'open') acts.push(h('button', { class: 'btn small', type: 'button', onclick: () => cobrar(p) }, 'Cobrar'));
    else acts.push(h('button', { class: 'btn small', type: 'button', onclick: () => reinvertir(p) }, 'Reinvertir'));
    acts.push(h('button', { class: 'btn small ghost', type: 'button', onclick: () => go('form', { edit: p.id }) }, 'Editar'));
    acts.push(h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => eliminar(p) }, 'Eliminar'));
    return h('div', { class: 'card item' + (v.overdue ? ' overdue' : '') },
      h('div', { class: 'head' }, badge, p.sample ? h('span', { class: 'sample-tag' }, 'EJEMPLO') : null),
      h('div', { class: 'amt' }, money(p.capital) + ' → ' + money(p.total)),
      h('div', { class: 'mute' }, 'Colocada ' + fdate(p.date) + ' · ' + p.days + (p.days === 1 ? ' día' : ' días') + ' · vence ' + fdate(v.maturity) + (p.status === 'open' ? ' (' + C.daysText(v.daysLeft) + ')' : '')),
      h('div', { class: 'kv' },
        h('span', null, 'Ganancia'), h('span', null, money(v.m.gain) + ' · ' + pct(v.m.r)),
        h('span', null, 'TNA / TEM'), h('span', null, pct(v.m.tna) + ' / ' + pct(v.m.tem))),
      p.note ? h('div', null, p.note) : null,
      linked ? h('div', { class: 'mute' }, 'Reinversión de la colocación del ' + fdate(linked.date)) : null,
      h('div', { class: 'row' }, acts));
  }

  function cobrar(p) {
    const today = C.todayStr();
    modal((close) => {
      const date = h('input', { type: 'date', value: today, min: p.date });
      const err = h('div');
      return h('div', null,
        h('h2', null, 'Cobrar'),
        h('p', null, 'Vas a marcar como cobrados ' + money(p.total) + ' (capital ' + money(p.capital) + ' + ganancia ' + money(p.total - p.capital) + ').'),
        field('Fecha de cobro', date), err,
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancelar'),
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const r = C.markPaid(S, p.id, date.value);
            if (!r.ok) { err.replaceChildren(errBox([r.error])); return; }
            save(); close(); refresh();
            modal((c2) => h('div', null,
              h('h2', null, 'Cobrada'),
              h('p', null, 'Quedaron ' + money(p.total) + ' disponibles. ¿Querés reinvertir?'),
              h('div', { class: 'row' },
                h('button', { class: 'btn ghost', type: 'button', onclick: c2 }, 'Ahora no'),
                h('button', { class: 'btn', type: 'button', onclick: () => { c2(); reinvertir(p); } }, 'Reinvertir'))));
          } }, 'Confirmar cobro')));
    });
  }
  function reinvertir(p) {
    go('form', { prefill: { capital: p.total, date: C.todayStr(), fromBalance: true, linkedFrom: p.id } });
  }
  async function eliminar(p) {
    const ok = await ask('Eliminar colocación', 'Se va a borrar la colocación de ' + money(p.capital) + ' del ' + fdate(p.date) + (p.status === 'paid' ? ' (ya cobrada: cambiará el saldo disponible)' : '') + '. No se puede deshacer.', 'Eliminar', true);
    if (!ok) return;
    C.deletePlacement(S, p.id); save(); refresh(); toast('Colocación eliminada');
  }

  function chartSvg(bars) {
    const bw = 44, gap = 10, top = 22, bottom = 30, H = 200;
    const W = Math.max(300, bars.length * (bw + gap) + gap);
    const max = Math.max(...bars.map((b) => b.value), 1);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Cobros por período' });
    s.append(svg('line', { class: 'axis', x1: 0, x2: W, y1: H - bottom, y2: H - bottom }));
    bars.forEach((b, i) => {
      const x = gap + i * (bw + gap);
      const bh = Math.max(b.value > 0 ? 2 : 0, (b.value / max) * (H - top - bottom));
      s.append(svg('rect', { class: 'bar' + (b.late ? ' late' : ''), x, y: H - bottom - bh, width: bw, height: bh, rx: 4 }));
      if (b.value > 0) s.append(svg('text', { class: 'lbl', x: x + bw / 2, y: H - bottom - bh - 5 }, C.fmtCompact(b.value)));
      s.append(svg('text', { class: 'lbl2', x: x + bw / 2, y: H - 12 }, b.label));
    });
    return s;
  }

  function viewHome() {
    const today = C.todayStr();
    const T = C.totals(S, today);
    const root = h('div');

    for (const a of C.alerts(S, today)) {
      const btn = a.action === 'vencidas' ? h('button', { class: 'btn', type: 'button', onclick: () => { filters.estado = 'vencidas'; refresh(); document.getElementById('lista').scrollIntoView(); } }, 'Ver')
        : a.action === 'cierre' ? h('button', { class: 'btn', type: 'button', onclick: () => go('cierre') }, 'Cerrar')
          : a.action === 'respaldo' ? h('button', { class: 'btn', type: 'button', onclick: () => go('more') }, 'Respaldar') : null;
      root.append(h('div', { class: 'alert ' + a.kind, role: 'alert' }, h('span', null, a.text), btn));
    }

    root.append(h('div', { class: 'grid2' },
      statCard('Capital en curso', money(T.capitalOpen)),
      statCard('Ganancia a cobrar', money(T.gainOpen)),
      statCard('Total a devolverse', money(T.totalOpen)),
      statCard('Disponible sin colocar', money(T.disponible)),
      statCard('Ganancia total cobrada', money(T.gainPaid)),
      statCard('TNA promedio ponderada', T.tnaW == null ? '—' : pct(T.tnaW))));

    root.append(h('div', { style: null },
      h('button', { class: 'btn big', type: 'button', style: null, onclick: () => go('form') }, '+ Nueva colocación'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => go('calc') }, 'Calculadora'))));

    if (S.placements.some((p) => p.sample))
      root.append(h('div', { class: 'alert warn' }, h('span', null, 'Hay colocaciones de ejemplo cargadas.'),
        h('button', { class: 'btn', type: 'button', onclick: borrarEjemplos }, 'Borrar ejemplos')));

    // calendario de vencimientos
    const open = S.placements.filter((p) => p.status === 'open').sort((a, b) => (C.maturity(a) < C.maturity(b) ? -1 : 1));
    root.append(h('h2', null, 'Calendario de vencimientos'));
    const cal = h('div', { class: 'card' });
    if (!open.length) cal.append(h('p', { class: 'mute' }, 'No hay colocaciones en curso.'));
    for (const p of open) {
      const d = C.diffDays(today, C.maturity(p));
      cal.append(h('div', { class: 'cal' + (d < 0 ? ' late' : '') },
        h('div', { class: 'd' }, h('b', null, fdate(C.maturity(p))), h('div', { class: 'mute' }, C.daysText(d) + (p.note ? ' · ' + p.note : ''))),
        h('div', { class: 'a' }, money(p.total))));
    }
    root.append(cal);

    // lista
    root.append(h('h2', { id: 'lista' }, 'Colocaciones'));
    const sel = h('select', { 'aria-label': 'Estado', onchange: (e) => { filters.estado = e.target.value; refresh(); } },
      [['todas', 'Todas'], ['curso', 'En curso'], ['vencidas', 'Vencidas sin cobrar'], ['cobradas', 'Cobradas']].map(([v, t]) => h('option', { value: v }, t)));
    sel.value = filters.estado;
    root.append(h('div', { class: 'card' }, h('div', { class: 'field', style: null }, h('label', null, 'Estado'), sel),
      h('div', { class: 'inline' },
        h('div', null, h('label', { class: 'mute' }, 'Vence desde'), h('input', { type: 'date', value: filters.desde, onchange: (e) => { filters.desde = e.target.value; refresh(); } })),
        h('div', null, h('label', { class: 'mute' }, 'Vence hasta'), h('input', { type: 'date', value: filters.hasta, onchange: (e) => { filters.hasta = e.target.value; refresh(); } })))));
    const list = C.filterPlacements(S, filters, today);
    if (!list.length) root.append(h('p', { class: 'mute' }, S.placements.length ? 'Ninguna colocación coincide con el filtro.' : 'Todavía no cargaste colocaciones.'));
    for (const p of list) root.append(placementItem(p, today));

    // gráfico
    root.append(h('h2', null, 'Cobros según vencimientos'));
    const chartBox = h('div', { class: 'card' });
    const drawChart = () => {
      const { bars, truncated } = C.collections(S, chartMode, today);
      const seg = h('div', { class: 'seg' },
        h('button', { type: 'button', class: chartMode === 'semana' ? 'on' : '', onclick: () => { chartMode = 'semana'; drawChart(); } }, 'Por semana'),
        h('button', { type: 'button', class: chartMode === 'mes' ? 'on' : '', onclick: () => { chartMode = 'mes'; drawChart(); } }, 'Por mes'));
      chartBox.replaceChildren(seg, bars.length ? h('div', { class: 'chart' }, chartSvg(bars)) : h('p', { class: 'mute' }, 'No hay vencimientos para graficar.'));
      if (truncated) chartBox.append(h('p', { class: 'mute' }, 'Se muestran los primeros 12 períodos.'));
    };
    drawChart();
    root.append(chartBox);

    // historial de cierres
    root.append(h('h2', null, 'Historial de cierres'));
    if (!S.closings.length) root.append(h('p', { class: 'mute' }, 'Todavía no hiciste cierres. Podés hacerlo desde "Más".'));
    else root.append(closingsView());
    return root;
  }

  const CL = [['colocado', 'Colocado'], ['recuperado', 'Capital recuperado'], ['ganancia', 'Ganancia cobrada'], ['reinvertido', 'Reinvertido'], ['retirado', 'Retirado'], ['aportes', 'Aportes nuevos'], ['disponible', 'Disponible al cierre'], ['enCurso', 'Capital en curso al cierre']];
  function closingsView() {
    const wrap = h('div');
    const cs = S.closings.slice().sort((a, b) => (a.to < b.to ? 1 : -1));
    const few = cs.slice(0, 6);
    const tbl = h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'Período'), few.map((c) => h('th', null, fdate(c.from).slice(0, 5) + '–' + fdate(c.to).slice(0, 5))))),
      h('tbody', null, CL.map(([k, l]) => h('tr', null, h('td', null, l), few.map((c) => h('td', null, money(c.m[k])))))));
    wrap.append(h('div', { class: 'card scroll' }, tbl));
    for (const c of cs) {
      const changed = C.closingChanged(S, c);
      wrap.append(h('details', { class: 'card' },
        h('summary', null, fdate(c.from) + ' al ' + fdate(c.to), changed ? h('span', { class: 'sample-tag' }, 'datos cambiaron') : null),
        changed ? h('p', { class: 'mute' }, 'Algo se editó, cobró o borró desde este cierre. Los números de abajo son los de ese día y no se recalculan.') : null,
        h('div', { class: 'kv' }, CL.map(([k, l]) => [h('span', null, l), h('span', null, money(c.m[k]))])),
        h('h3', null, 'Próximos vencimientos al cierre'),
        c.upcoming.length ? c.upcoming.map((u) => h('div', { class: 'cal' }, h('div', null, fdate(u.date) + (u.note ? ' · ' + u.note : '')), h('div', { class: 'a' }, money(u.total))))
          : h('p', { class: 'mute' }, 'Ninguno.')));
    }
    return wrap;
  }
  async function borrarEjemplos() {
    const n = S.placements.filter((p) => p.sample).length;
    if (!(await ask('Borrar ejemplos', 'Se borrarán ' + n + ' colocaciones de ejemplo. Tus datos reales no se tocan.', 'Borrar', true))) return;
    S.placements = S.placements.filter((p) => !p.sample);
    save(); refresh(); toast('Ejemplos borrados');
  }

  /* ---------- Formulario de colocación ---------- */
  function viewForm() {
    const today = C.todayStr();
    const edit = ctx.edit ? S.placements.find((p) => p.id === ctx.edit) : null;
    const pre = edit || ctx.prefill || {};
    const f = {
      capital: textIn(pre.capital != null ? plain(pre.capital) : ''),
      days: textIn(pre.days != null ? String(pre.days) : '', 'numeric'),
      total: textIn(pre.total != null ? plain(pre.total) : ''),
      date: h('input', { type: 'date', value: pre.date || today }),
      note: h('input', { type: 'text', maxlength: '80', autocomplete: 'off', value: pre.note || '' }),
      from: h('input', { type: 'checkbox', id: 'fb', checked: !!pre.fromBalance }),
    };
    const outs = {};
    const kv = h('div', { class: 'kv' });
    for (const [k, l] of [['gain', 'Ganancia'], ['r', 'Rendimiento del plazo'], ['tna', 'TNA'], ['tem', 'TEM'], ['due', 'Vencimiento'], ['left', 'Días restantes']]) {
      outs[k] = h('span', null, '—'); kv.append(h('span', null, l), outs[k]);
    }
    const errs = h('div');
    const linked = !edit && ctx.prefill && ctx.prefill.linkedFrom ? S.placements.find((p) => p.id === ctx.prefill.linkedFrom) : null;
    const avail = C.balance(S) + (edit && edit.fromBalance ? edit.capital : 0);
    const upd = () => {
      const cap = C.parseNum(f.capital.value), d = C.parseNum(f.days.value), tot = C.parseNum(f.total.value);
      const dOk = Number.isInteger(d) && d >= 1, dateOk = !isNaN(C.parseDate(f.date.value));
      Object.values(outs).forEach((o) => { o.textContent = '—'; });
      if (cap > 0 && tot > 0) {
        const m = C.metrics(cap, tot, dOk ? d : 1);
        outs.gain.textContent = money(m.gain); outs.r.textContent = pct(m.r);
        if (dOk) { outs.tna.textContent = pct(m.tna); outs.tem.textContent = pct(m.tem); }
      }
      if (dOk && dateOk) {
        const due = C.addDays(f.date.value, d);
        outs.due.textContent = fdate(due);
        const left = C.diffDays(today, due);
        outs.left.textContent = edit && edit.status === 'paid' ? 'Cobrada' : left === 0 ? 'Vence hoy' : left > 0 ? left + (left === 1 ? ' día' : ' días') : 'Vencida hace ' + -left + (left === -1 ? ' día' : ' días');
      }
    };
    [f.capital, f.days, f.total, f.date].forEach((i) => i.addEventListener('input', upd));
    upd();
    const form = h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const input = { capital: C.parseNum(f.capital.value), days: C.parseNum(f.days.value), total: C.parseNum(f.total.value), date: f.date.value, note: f.note.value, fromBalance: f.from.checked, linkedFrom: !edit && ctx.prefill ? ctx.prefill.linkedFrom : null };
      const r = edit ? C.updatePlacement(S, edit.id, input) : C.addPlacement(S, input);
      if (!r.ok) { errs.replaceChildren(errBox(r.errors)); errs.scrollIntoView({ block: 'center' }); return; }
      save(); toast(edit ? 'Cambios guardados' : 'Colocación guardada'); go('home');
    } },
      linked ? h('div', { class: 'alert info' }, 'Reinversión de la colocación del ' + fdate(linked.date) + ' (cobrado: ' + money(linked.total) + '). Podés bajar el capital para reinvertir solo una parte.') : null,
      field('Capital colocado ($)', f.capital),
      field('Plazo (días)', f.days),
      field('Monto total a recibir ($)', f.total, 'Capital + ganancia'),
      field('Fecha de colocación', f.date),
      field('Nota o referencia (opcional)', f.note),
      h('div', { class: 'check' }, f.from, h('label', { for: 'fb' }, 'Sale del saldo disponible (disponible: ' + money(avail) + ')')),
      h('div', { class: 'live' }, kv),
      errs,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => go('home') }, 'Cancelar'),
        h('button', { class: 'btn', type: 'submit' }, 'Guardar')));
    return h('div', null, h('h2', null, edit ? 'Editar colocación' : linked ? 'Reinvertir' : 'Nueva colocación'), form);
  }

  /* ---------- Calculadora ---------- */
  const TIPOS = [['diaria', 'Diaria (%)'], ['mensual', 'Mensual (%)'], ['tna', 'TNA (%)'], ['plazo', 'Total del plazo (%)']];
  function viewCalc() {
    const sel = (key, opts, extra) => {
      const s = h('select', extra, opts.map(([v, t]) => h('option', { value: v }, t)));
      s.value = calc[key];
      s.addEventListener('change', () => { calc[key] = s.value; run(); });
      return s;
    };
    const inp = (key, mode, extra) => {
      const i = textIn(calc[key], mode, extra);
      i.addEventListener('input', () => { calc[key] = i.value; run(); });
      return i;
    };
    const out = h('div');
    const second = h('div');
    const cmpBox = h('input', { type: 'checkbox', id: 'cmp', checked: calc.comparar });
    cmpBox.addEventListener('change', () => { calc.comparar = cmpBox.checked; drawSecond(); run(); });
    function drawSecond() {
      second.replaceChildren();
      if (!calc.comparar) return;
      second.append(h('div', { class: 'inline' }, field('Tasa B: tipo', sel('tipo2', TIPOS)), field('Tasa B (%)', inp('tasa2'))));
    }
    drawSecond();

    function scenario(sim, label, x) {
      const col = h('div', { class: 'card' + (label ? ' cmp' : '') });
      if (label) col.append(h('h3', null, label));
      col.append(h('div', { class: 'kv' },
        h('span', null, 'Ganancia'), h('span', null, money(sim.gain)),
        h('span', null, 'Total a recibir'), h('span', null, money(sim.total)),
        h('span', null, 'Rendimiento del plazo'), h('span', null, pct(sim.r)),
        h('span', null, 'TNA equivalente'), h('span', null, pct(sim.tna)),
        h('span', null, 'TEM equivalente'), h('span', null, pct(sim.tem)),
        sim.due1 ? [h('span', null, 'Vencimiento'), h('span', null, fdate(sim.due1))] : null));
      col.append(h('h3', null, 'Acumulado (' + x.cycles + (x.cycles === 1 ? ' ciclo' : ' ciclos') + ')'));
      col.append(h('div', { class: 'kv' },
        h('span', null, 'Capital final'), h('span', null, money(sim.final)),
        h('span', null, 'Ganancia total'), h('span', null, money(sim.gainTotal)),
        h('span', null, 'Días totales'), h('span', null, String(sim.totalDays)),
        h('span', null, 'Multiplicador'), h('span', null, C.fmtTrim(sim.mult, 4) + '×'),
        sim.dueLast ? [h('span', null, 'Fin del último ciclo'), h('span', null, fdate(sim.dueLast))] : null));
      return col;
    }
    function cyclesTable(sim, label) {
      return h('div', { class: 'card scroll' }, label ? h('h3', null, 'Ciclos ' + label) : null,
        h('table', { class: 't' },
          h('thead', null, h('tr', null, ['Ciclo', 'Capital inicial', 'Ganancia', 'Total'].map((t) => h('th', null, t)))),
          h('tbody', null, sim.rows.map((r) => h('tr', null, h('td', null, String(r.n)), h('td', null, money(r.capital)), h('td', null, money(r.gain)), h('td', null, money(r.total)))))));
    }
    function useIn(sim, x) {
      return h('button', { class: 'btn', type: 'button', onclick: () => go('form', { prefill: { capital: x.capital, days: x.days, total: sim.total, date: x.start || C.todayStr() } }) }, 'Usar en una nueva colocación' + (x.tag ? ' (' + x.tag + ')' : ''));
    }
    function run() {
      const base = { capital: C.parseNum(calc.monto), days: C.parseNum(calc.plazo), mode: calc.modo, cycles: C.parseNum(calc.ciclos), start: calc.inicio || '' };
      const xa = Object.assign({ type: calc.tipo, rate: C.parseNum(calc.tasa) }, base);
      const xb = Object.assign({ type: calc.tipo2, rate: C.parseNum(calc.tasa2) }, base);
      out.replaceChildren();
      if (!calc.monto.trim() || !calc.tasa.trim() || !calc.plazo.trim() || (calc.comparar && !calc.tasa2.trim())) {
        out.append(h('p', { class: 'mute' }, 'Completá monto, tasa y plazo para ver el resultado.')); return;
      }
      const a = C.simulate(xa), b = calc.comparar ? C.simulate(xb) : null;
      const errors = [].concat(a.errors.map((e) => (b ? 'A: ' : '') + e), b ? b.errors.filter((e) => !a.errors.includes(e)).map((e) => 'B: ' + e) : []);
      if (errors.length) { out.append(errBox(errors)); return; }
      xa.tag = b ? 'A' : ''; xb.tag = 'B';
      if (b) {
        out.append(h('div', { class: 'grid2' }, scenario(a, 'Escenario A', xa), scenario(b, 'Escenario B', xb)));
        out.append(cyclesTable(a, 'A'), cyclesTable(b, 'B'));
        out.append(h('div', { class: 'row' }, useIn(a, xa), useIn(b, xb)));
      } else {
        out.append(scenario(a, null, xa), cyclesTable(a, ''), useIn(a, xa));
      }
      out.append(h('p', { class: 'mute' }, 'Es una simulación: no se guarda nada hasta que confirmes una colocación. La nueva colocación toma el primer ciclo.'));
    }
    const root = h('div', null,
      h('p', { class: 'mute' }, 'Simulá sin guardar nada. No usa tus datos reales.'),
      field('Monto a colocar ($)', inp('monto')),
      h('div', { class: 'inline' }, field('Tipo de tasa', sel('tipo', TIPOS)), field('Tasa (%)', inp('tasa'))),
      h('div', { class: 'inline' }, field('Plazo (días)', inp('plazo', 'numeric')), field('Ciclos (1 a 36)', inp('ciclos', 'numeric'))),
      field('Modo de interés', sel('modo', [['simple', 'Simple'], ['compuesto', 'Compuesto diario']])),
      field('Fecha de inicio (opcional)', (() => { const i = h('input', { type: 'date', value: calc.inicio }); i.addEventListener('input', () => { calc.inicio = i.value; run(); }); return i; })()),
      h('div', { class: 'check' }, cmpBox, h('label', { for: 'cmp' }, 'Comparar con otra tasa')),
      second, out);
    run();
    return root;
  }

  /* ---------- Más ---------- */
  function movementModal(type) {
    const w = type === 'withdraw';
    modal((close) => {
      const amount = textIn(''), date = h('input', { type: 'date', value: C.todayStr() }), note = h('input', { type: 'text', maxlength: '80', autocomplete: 'off' });
      const err = h('div');
      return h('div', null, h('h2', null, w ? 'Registrar retiro' : 'Registrar aporte nuevo'),
        h('p', { class: 'mute' }, 'Disponible ahora: ' + money(C.balance(S))),
        field('Monto ($)', amount), field('Fecha', date), field('Nota (opcional)', note), err,
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancelar'),
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const r = C.addMovement(S, { type, amount: C.parseNum(amount.value), date: date.value, note: note.value });
            if (!r.ok) { err.replaceChildren(errBox(r.errors)); return; }
            save(); close(); refresh(); toast(w ? 'Retiro registrado' : 'Aporte registrado');
          } }, 'Guardar')));
    });
  }
  function download(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function doExport(kind) {
    const today = C.todayStr();
    if (kind === 'json') download('colocaciones-respaldo-' + today + '.json', 'application/json', JSON.stringify(C.exportData(S), null, 1));
    else download('colocaciones-' + today + '.csv', 'text/csv;charset=utf-8', C.toCSV(S));
    S.settings.lastBackup = today; save(); refresh(); toast('Archivo exportado');
  }
  async function doImport(file) {
    if (!file) return;
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { modal((c) => h('div', null, h('h2', null, 'No se pudo importar'), errBox(['El archivo no es un JSON válido.']), h('button', { class: 'btn', type: 'button', onclick: c }, 'Entendido'))); return; }
    const v = C.validateImport(obj);
    if (!v.ok) { modal((c) => h('div', null, h('h2', null, 'No se pudo importar'), errBox([v.error]), h('p', { class: 'mute' }, 'No se modificó ningún dato.'), h('button', { class: 'btn', type: 'button', onclick: c }, 'Entendido'))); return; }
    const d = v.data;
    const ok = await ask('Reemplazar todos los datos', 'Hoy tenés ' + S.placements.length + ' colocaciones, ' + S.movements.length + ' movimientos y ' + S.closings.length + ' cierres. El archivo trae ' + d.placements.length + ', ' + d.movements.length + ' y ' + d.closings.length + '. Se van a reemplazar los datos actuales por los del archivo.', 'Reemplazar', true);
    if (!ok) return;
    S.placements = d.placements; S.movements = d.movements; S.closings = d.closings;
    if (d.cycleDays) S.settings.cycleDays = d.cycleDays;
    S.settings.lastBackup = C.todayStr();
    save(); toast('Datos importados'); go('home');
  }
  function pinModal(mode) { // 'set' | 'change' | 'off'
    modal((close) => {
      const mk = (ph) => h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', placeholder: ph });
      const cur = mk('PIN actual'), n1 = mk('PIN nuevo (4 a 6 dígitos)'), n2 = mk('Repetir PIN nuevo');
      const err = h('div');
      const needCur = mode !== 'set', needNew = mode !== 'off';
      return h('div', null, h('h2', null, mode === 'set' ? 'Activar PIN' : mode === 'change' ? 'Cambiar PIN' : 'Desactivar PIN'),
        h('p', { class: 'mute' }, 'Es una traba básica, no un cifrado fuerte.'),
        needCur ? field('PIN actual', cur) : null, needNew ? [field('PIN nuevo', n1), field('Repetir PIN nuevo', n2)] : null, err,
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancelar'),
          h('button', { class: 'btn', type: 'button', onclick: () => {
            const e = [];
            if (needCur && C.hashPin(cur.value, S.settings.pinSalt) !== S.settings.pinHash) e.push('El PIN actual no es correcto.');
            if (needNew) {
              if (!/^\d{4,6}$/.test(n1.value)) e.push('El PIN nuevo debe tener entre 4 y 6 dígitos.');
              else if (n1.value !== n2.value) e.push('Los PIN nuevos no coinciden.');
            }
            if (e.length) { err.replaceChildren(errBox(e)); return; }
            if (needNew) { const salt = C.newSalt(); S.settings.pinSalt = salt; S.settings.pinHash = C.hashPin(n1.value, salt); S.settings.pinLen = n1.value.length; }
            else { S.settings.pinSalt = null; S.settings.pinHash = null; S.settings.pinLen = 0; }
            save(); close(); refresh(); toast(mode === 'off' ? 'PIN desactivado' : 'PIN guardado');
          } }, 'Guardar')));
    });
  }
  function viewMore() {
    const today = C.todayStr();
    const root = h('div');
    root.append(h('h2', null, 'Dinero disponible'));
    root.append(h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Disponible sin colocar'), h('div', { class: 'v' }, money(C.balance(S)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => movementModal('withdraw') }, 'Registrar retiro'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => movementModal('contribution') }, 'Registrar aporte'))));
    const mv = S.movements.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
    if (mv.length) {
      const box = h('div', { class: 'card' });
      for (const m of mv) box.append(h('div', { class: 'cal' },
        h('div', null, h('b', null, m.type === 'withdraw' ? 'Retiro' : 'Aporte'), h('div', { class: 'mute' }, fdate(m.date) + (m.note ? ' · ' + m.note : ''))),
        h('div', { class: 'a' }, (m.type === 'withdraw' ? '-' : '+') + money(m.amount).replace('$ ', '$ '),
          h('div', null, h('button', { class: 'btn small ghost danger', type: 'button', onclick: async () => {
            if (await ask('Eliminar movimiento', 'Se va a borrar este ' + (m.type === 'withdraw' ? 'retiro' : 'aporte') + ' de ' + money(m.amount) + '.', 'Eliminar', true)) { S.movements = S.movements.filter((x) => x.id !== m.id); save(); refresh(); }
          } }, 'Borrar')))));
      root.append(h('p', { class: 'mute' }, 'Últimos movimientos'), box);
    }

    root.append(h('h2', null, 'Cierres'));
    const per = h('input', { type: 'text', inputmode: 'numeric', value: String(S.settings.cycleDays), 'aria-label': 'Días del período' });
    per.addEventListener('change', () => {
      const n = C.parseNum(per.value);
      if (Number.isInteger(n) && n >= 1 && n <= 365) { S.settings.cycleDays = n; save(); toast('Período guardado'); }
      else { per.value = String(S.settings.cycleDays); toast('Ingresá un número de días entre 1 y 365'); }
    });
    root.append(h('div', { class: 'card' }, h('button', { class: 'btn', type: 'button', onclick: () => go('cierre') }, 'Hacer cierre'), field('Duración del período (días)', per)));

    root.append(h('h2', null, 'Respaldo'));
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { doImport(e.target.files[0]); e.target.value = ''; } });
    root.append(h('div', { class: 'card' },
      h('p', { class: 'mute' }, S.settings.lastBackup ? 'Último respaldo: ' + fdate(S.settings.lastBackup) + ' (hace ' + C.diffDays(S.settings.lastBackup, today) + ' días)' : 'Todavía no hiciste ningún respaldo.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => doExport('json') }, 'Exportar JSON (respaldo)'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => doExport('csv') }, 'Exportar CSV (planilla)')),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => fileIn.click() }, 'Importar respaldo JSON')), fileIn,
      h('p', { class: 'mute' }, 'Los datos viven solo en este dispositivo. Si borrás los datos del navegador o cambiás de teléfono, se pierden: guardá el JSON en un lugar seguro.')));

    root.append(h('h2', null, 'PIN de acceso'));
    root.append(h('div', { class: 'card' }, S.settings.pinHash
      ? [h('p', null, 'PIN activado (' + S.settings.pinLen + ' dígitos).'), h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => pinModal('change') }, 'Cambiar PIN'), h('button', { class: 'btn ghost danger', type: 'button', onclick: () => pinModal('off') }, 'Desactivar PIN'))]
      : [h('p', { class: 'mute' }, 'Sin PIN. Es una traba básica para abrir la app, no un cifrado: los datos siguen guardados sin cifrar en el dispositivo.'), h('button', { class: 'btn', type: 'button', onclick: () => pinModal('set') }, 'Activar PIN')]));

    if (S.placements.some((p) => p.sample)) root.append(h('h2', null, 'Ejemplos'), h('div', { class: 'card' }, h('button', { class: 'btn ghost danger', type: 'button', onclick: borrarEjemplos }, 'Borrar colocaciones de ejemplo')));
    root.append(h('p', { class: 'mute' }, 'Sin servidor ni conexión: esta app nunca envía tus datos a ningún lado.'));
    return root;
  }

  /* ---------- Cierre ---------- */
  function viewCierre() {
    const today = C.todayStr();
    const { from, to, last } = C.nextClosingPeriod(S, today);
    const root = h('div');
    if (from > to) {
      root.append(h('div', { class: 'alert info' }, 'Ya hiciste un cierre hasta hoy (' + fdate(last.to) + '). El próximo período arranca mañana.'), h('button', { class: 'btn ghost', type: 'button', onclick: () => go('more') }, 'Volver'));
      return root;
    }
    const r = C.periodMetrics(S, from, to);
    root.append(h('h2', null, 'Período ' + fdate(from) + ' al ' + fdate(to)),
      h('div', { class: 'card' }, h('div', { class: 'kv' }, CL.map(([k, l]) => [h('span', null, l), h('span', null, money(r.m[k]))]))),
      h('h3', null, 'Próximos vencimientos'),
      h('div', { class: 'card' }, r.upcoming.length ? r.upcoming.map((u) => h('div', { class: 'cal' }, h('div', null, fdate(u.date) + (u.note ? ' · ' + u.note : '')), h('div', { class: 'a' }, money(u.total)))) : h('p', { class: 'mute' }, 'Ninguno.')),
      h('p', { class: 'mute' }, 'Al guardar, el cierre queda fijo: si después editás un dato, el cierre no se recalcula.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => go('more') }, 'Cancelar'),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          const res = C.makeClosing(S, today);
          if (!res.ok) { toast(res.error); return; }
          save(); toast('Cierre guardado'); go('home');
        } }, 'Guardar cierre')));
    return root;
  }

  /* ---------- PIN al iniciar ---------- */
  function showLock() {
    const lock = $('#lock');
    lock.hidden = false;
    const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', 'aria-label': 'PIN' });
    const msg = h('div', { class: 'mute', role: 'alert' });
    const tryPin = () => {
      if (C.hashPin(pin.value, S.settings.pinSalt) === S.settings.pinHash) { lock.hidden = true; lock.replaceChildren(); start(); }
      else if (pin.value.length >= S.settings.pinLen) { msg.textContent = 'PIN incorrecto'; pin.value = ''; }
    };
    pin.addEventListener('input', () => { if (pin.value.length === S.settings.pinLen) tryPin(); });
    lock.replaceChildren(h('h1', null, 'Colocaciones'), h('p', null, 'Ingresá tu PIN'), pin, msg, h('button', { class: 'btn', type: 'button', onclick: tryPin }, 'Entrar'));
    pin.focus();
  }

  /* ---------- inicio ---------- */
  let started = false;
  function start() {
    $('#app').hidden = false;
    renderBanner();
    if (started) { render(true); return; }
    started = true;
    document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    window.addEventListener('hashchange', () => render(true));
    render(true);
  }
  function init() {
    S = load();
    if (!S) {
      S = C.emptyState(C.todayStr());
      S.placements = C.samplePlacements(C.todayStr());
      save();
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* no soportado */ }
    if (S.settings.pinHash) showLock(); else start();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* la app funciona igual sin service worker */ });
    }
  }
  init();
})();
