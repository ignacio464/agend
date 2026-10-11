'use strict';
/* Lógica pura de la app (sin DOM). Se usa desde app.js y desde las pruebas en Node. */
(function (root) {
  const DAY = 86400000;
  const EPS = 0.005;
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- Fechas (siempre 'AAAA-MM-DD' en hora local, sin pasar por UTC) ---------- */
  function parseDate(s) {
    if (typeof s !== 'string') return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return NaN;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1970 || y > 2200) return NaN;
    const t = Date.UTC(y, mo - 1, d);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return t / DAY; // número de día entero
  }
  function dayToStr(n) {
    const dt = new Date(n * DAY);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function todayStr(now) {
    now = now || new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }
  const addDays = (s, d) => dayToStr(parseDate(s) + d);
  const diffDays = (a, b) => parseDate(b) - parseDate(a); // b - a
  function fmtDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  /* ---------- Números (formato argentino) ---------- */
  function parseNum(v) {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(/^\$/, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }
  function fmtNum(n, dec) {
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1e21) return n.toExponential(2).replace('.', ',');
    const s = Math.abs(n).toFixed(dec);
    const parts = s.split('.');
    const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const body = parts[1] ? int + ',' + parts[1] : int;
    return (n < 0 && /[1-9]/.test(s) ? '-' : '') + body;
  }
  function fmtTrim(n, maxDec) {
    let s = fmtNum(n, maxDec);
    if (s.includes(',')) s = s.replace(/0+$/, '').replace(/,$/, '');
    return s;
  }
  function fmtMoney(n) {
    if (!isFinite(n)) return '—';
    const whole = Math.abs(n - Math.round(n)) < EPS;
    const s = fmtNum(Math.abs(n), whole ? 0 : 2);
    return (n < 0 && /[1-9]/.test(s) ? '-' : '') + '$ ' + s;
  }
  const fmtPct = (frac) => (isFinite(frac) ? fmtTrim(frac * 100, 2) + '%' : '—');
  function fmtCompact(n) {
    if (n >= 1e6) return fmtTrim(n / 1e6, 1) + ' M';
    if (n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(Math.round(n));
  }
  const daysText = (n) =>
    n === 0 ? 'vence hoy' : n > 0 ? 'en ' + n + (n === 1 ? ' día' : ' días') : 'venció hace ' + -n + (n === -1 ? ' día' : ' días');

  /* ---------- Fórmulas ---------- */
  function metrics(C, T, d) {
    const gain = T - C;
    const r = gain / C;
    return { gain, r, tna: (r * 365) / d, tem: Math.pow(1 + r, 30 / d) - 1 };
  }
  const maturity = (p) => addDays(p.date, p.days);

  function placementView(p, today) {
    const mat = maturity(p);
    const daysLeft = diffDays(today, mat);
    return { maturity: mat, daysLeft, overdue: p.status === 'open' && daysLeft < 0, m: metrics(p.capital, p.total, p.days) };
  }

  /* ---------- Calculadora ---------- */
  function rateToDaily(type, rate, d) {
    const r = rate / 100;
    if (type === 'diaria') return r;
    if (type === 'mensual') return r / 30;
    if (type === 'tna') return r / 365;
    return r / d; // 'plazo'
  }
  function checkSim(x) {
    const e = [];
    if (!(x.capital > 0)) e.push('El monto a colocar debe ser mayor a 0.');
    if (!(x.rate > 0)) e.push('La tasa debe ser mayor a 0.');
    if (!(Number.isInteger(x.days) && x.days >= 1)) e.push('El plazo debe ser un número entero de días (1 o más).');
    if (!(Number.isInteger(x.cycles) && x.cycles >= 1 && x.cycles <= 36)) e.push('Los ciclos de reinversión deben ser un entero entre 1 y 36.');
    if (x.start && isNaN(parseDate(x.start))) e.push('La fecha de inicio no es válida.');
    return e;
  }
  function simulate(x) {
    const e = checkSim(x);
    if (e.length) return { errors: e };
    const i = rateToDaily(x.type, x.rate, x.days);
    const rows = [];
    let c = x.capital;
    for (let k = 1; k <= x.cycles; k++) {
      const total = x.mode === 'compuesto' ? c * Math.pow(1 + i, x.days) : c * (1 + i * x.days);
      rows.push({ n: k, capital: c, gain: total - c, total });
      c = total;
    }
    if (!isFinite(c) || c > 1e18) return { errors: ['El resultado es demasiado grande. Revisá la tasa y el plazo.'] };
    const m = metrics(x.capital, rows[0].total, x.days);
    return {
      errors: [], i, rows, gain: m.gain, total: rows[0].total, r: m.r, tna: m.tna, tem: m.tem,
      final: c, gainTotal: c - x.capital, totalDays: x.days * x.cycles, mult: c / x.capital,
      due1: x.start ? addDays(x.start, x.days) : null,
      dueLast: x.start ? addDays(x.start, x.days * x.cycles) : null,
    };
  }

  /* ---------- Estado ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function emptyState(today) {
    return {
      version: 1,
      settings: { pinHash: null, pinSalt: null, pinLen: 0, cycleDays: 10, lastBackup: null, createdAt: today },
      placements: [], movements: [], closings: [],
    };
  }
  function samplePlacements(today) {
    const mk = (cap, days, tot, ago, note) => ({
      id: uid(), capital: cap, days, total: tot, date: addDays(today, -ago), note, status: 'open', paidDate: null,
      fromBalance: false, linkedFrom: null, sample: true,
    });
    return [mk(500000, 30, 540000, 27, 'Ejemplo 1'), mk(1000000, 60, 1100000, 10, 'Ejemplo 2'), mk(200000, 15, 214000, 2, 'Ejemplo 3')];
  }

  function balance(S, asOf) {
    const ok = (d) => !asOf || d <= asOf;
    let b = 0;
    for (const p of S.placements) {
      if (p.status === 'paid' && ok(p.paidDate)) b += p.total;
      if (p.fromBalance && ok(p.date)) b -= p.capital;
    }
    for (const m of S.movements) if (ok(m.date)) b += m.type === 'contribution' ? m.amount : -m.amount;
    return b;
  }

  function totals(S, today) {
    const open = S.placements.filter((p) => p.status === 'open');
    let capitalOpen = 0, totalOpen = 0, wsum = 0;
    for (const p of open) {
      capitalOpen += p.capital; totalOpen += p.total;
      wsum += metrics(p.capital, p.total, p.days).tna * p.capital;
    }
    let gainPaid = 0;
    for (const p of S.placements) if (p.status === 'paid') gainPaid += p.total - p.capital;
    return {
      capitalOpen, totalOpen, gainOpen: totalOpen - capitalOpen, gainPaid,
      tnaW: capitalOpen > 0 ? wsum / capitalOpen : null,
      disponible: balance(S),
      overdue: open.filter((p) => diffDays(today, maturity(p)) < 0),
      openCount: open.length,
    };
  }

  function checkPlacement(p) {
    const e = [];
    if (!(p.capital > 0)) e.push('El capital debe ser mayor a 0.');
    if (!(Number.isInteger(p.days) && p.days >= 1)) e.push('El plazo debe ser un número entero de días (1 o más).');
    if (!(p.total > 0)) e.push('El monto a recibir debe ser mayor a 0.');
    else if (p.capital > 0 && p.total < p.capital) e.push('El monto a recibir no puede ser menor al capital.');
    if (isNaN(parseDate(p.date))) e.push('La fecha de colocación no es válida.');
    if (p.capital > 1e13 || p.total > 1e13) e.push('El monto es demasiado grande.');
    if (p.days > 36500) e.push('El plazo es demasiado largo.');
    return e;
  }
  function clean(x) {
    return {
      capital: x.capital, days: x.days, total: x.total, date: x.date,
      note: typeof x.note === 'string' ? x.note.trim().slice(0, 80) : '',
      fromBalance: !!x.fromBalance, linkedFrom: x.linkedFrom || null,
    };
  }
  function addPlacement(S, input) {
    const q = clean(input);
    const e = checkPlacement(q);
    if (!e.length && q.fromBalance && q.capital > balance(S) + EPS)
      e.push('El capital supera el saldo disponible (' + fmtMoney(balance(S)) + '). Desmarcá "Sale del saldo disponible" o registrá un aporte.');
    if (e.length) return { ok: false, errors: e };
    const p = Object.assign({ id: uid(), status: 'open', paidDate: null, sample: false }, q);
    S.placements.push(p);
    return { ok: true, placement: p };
  }
  function updatePlacement(S, id, input) {
    const p = S.placements.find((x) => x.id === id);
    if (!p) return { ok: false, errors: ['No se encontró la colocación.'] };
    const q = clean(input);
    q.linkedFrom = p.linkedFrom;
    const e = checkPlacement(q);
    if (!e.length && p.status === 'paid' && p.paidDate < q.date) e.push('La fecha de colocación no puede ser posterior al cobro (' + fmtDate(p.paidDate) + ').');
    if (!e.length && q.fromBalance) {
      const avail = balance(S) + (p.fromBalance ? p.capital : 0);
      if (q.capital > avail + EPS) e.push('El capital supera el saldo disponible (' + fmtMoney(avail) + ').');
    }
    if (e.length) return { ok: false, errors: e };
    Object.assign(p, q);
    return { ok: true, placement: p };
  }
  function deletePlacement(S, id) {
    S.placements = S.placements.filter((p) => p.id !== id);
    for (const p of S.placements) if (p.linkedFrom === id) p.linkedFrom = null;
  }
  function markPaid(S, id, date) {
    const p = S.placements.find((x) => x.id === id);
    if (!p || p.status !== 'open') return { ok: false, error: 'La colocación ya está cobrada o no existe.' };
    if (isNaN(parseDate(date))) return { ok: false, error: 'La fecha de cobro no es válida.' };
    if (date < p.date) return { ok: false, error: 'El cobro no puede ser anterior a la colocación (' + fmtDate(p.date) + ').' };
    p.status = 'paid'; p.paidDate = date;
    return { ok: true, placement: p };
  }
  function addMovement(S, input) {
    const type = input.type;
    const e = [];
    if (type !== 'withdraw' && type !== 'contribution') e.push('Tipo de movimiento inválido.');
    if (!(input.amount > 0)) e.push('El monto debe ser mayor a 0.');
    else if (input.amount > 1e13) e.push('El monto es demasiado grande.');
    if (isNaN(parseDate(input.date))) e.push('La fecha no es válida.');
    if (!e.length && type === 'withdraw' && input.amount > balance(S) + EPS)
      e.push('El retiro supera el saldo disponible (' + fmtMoney(balance(S)) + ').');
    if (e.length) return { ok: false, errors: e };
    const m = { id: uid(), type, amount: input.amount, date: input.date, note: String(input.note || '').trim().slice(0, 80) };
    S.movements.push(m);
    return { ok: true, movement: m };
  }

  /* ---------- Cierres ---------- */
  function periodMetrics(S, from, to) {
    const inP = (d) => d >= from && d <= to;
    const m = { colocado: 0, recuperado: 0, ganancia: 0, reinvertido: 0, retirado: 0, aportes: 0, disponible: 0, enCurso: 0 };
    const upcoming = [];
    for (const p of S.placements) {
      if (inP(p.date)) { m.colocado += p.capital; if (p.fromBalance) m.reinvertido += p.capital; }
      if (p.status === 'paid' && inP(p.paidDate)) { m.recuperado += p.capital; m.ganancia += p.total - p.capital; }
      if (p.date <= to && !(p.status === 'paid' && p.paidDate <= to)) {
        m.enCurso += p.capital;
        upcoming.push({ date: maturity(p), capital: p.capital, total: p.total, note: p.note || '' });
      }
    }
    for (const x of S.movements) {
      if (!inP(x.date)) continue;
      if (x.type === 'withdraw') m.retirado += x.amount; else m.aportes += x.amount;
    }
    m.disponible = balance(S, to);
    upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { m, upcoming };
  }
  function nextClosingPeriod(S, today) {
    const last = S.closings.length ? S.closings.reduce((a, b) => (a.to > b.to ? a : b)) : null;
    let from;
    if (last) from = addDays(last.to, 1);
    else {
      const dates = S.placements.map((p) => p.date).concat(S.movements.map((m) => m.date));
      from = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today;
    }
    return { from, to: today, last };
  }
  function makeClosing(S, today) {
    const { from, to } = nextClosingPeriod(S, today);
    if (from > to) return { ok: false, error: 'Ya hiciste un cierre hasta hoy.' };
    const r = periodMetrics(S, from, to);
    const c = { id: uid(), createdAt: today, from, to, m: r.m, upcoming: r.upcoming };
    S.closings.push(c);
    return { ok: true, closing: c };
  }
  const r2 = (x) => Math.round(x * 100);
  function closingChanged(S, c) {
    const now = periodMetrics(S, c.from, c.to);
    for (const k of Object.keys(c.m)) if (r2(c.m[k]) !== r2(now.m[k])) return true;
    const sig = (u) => u.map((x) => x.date + '|' + r2(x.capital) + '|' + r2(x.total)).join(',');
    return sig(c.upcoming) !== sig(now.upcoming);
  }

  /* ---------- Alertas, filtros, gráfico ---------- */
  function alerts(S, today) {
    const out = [];
    const open = S.placements.filter((p) => p.status === 'open');
    const overdue = open.filter((p) => diffDays(today, maturity(p)) < 0);
    if (overdue.length) {
      const sum = overdue.reduce((a, p) => a + p.total, 0);
      out.push({ kind: 'bad', action: 'vencidas', text: overdue.length + (overdue.length === 1 ? ' colocación vencida' : ' colocaciones vencidas') + ', falta marcar como cobrada (' + fmtMoney(sum) + ').' });
    }
    const soon = open.filter((p) => { const d = diffDays(today, maturity(p)); return d >= 0 && d <= 7; });
    if (soon.length) {
      const sum = soon.reduce((a, p) => a + p.total, 0);
      out.push({ kind: 'warn', action: null, text: (soon.length === 1 ? '1 vencimiento' : soon.length + ' vencimientos') + ' en los próximos 7 días: ' + fmtMoney(sum) + '.' });
    }
    const real = S.placements.filter((p) => !p.sample).map((p) => p.date).concat(S.movements.map((m) => m.date));
    const lastC = S.closings.length ? S.closings.reduce((a, b) => (a.to > b.to ? a : b)).to : null;
    const ref = lastC || (real.length ? real.reduce((a, b) => (a < b ? a : b)) : null);
    if (ref) {
      const n = diffDays(ref, today);
      if (n >= S.settings.cycleDays)
        out.push({ kind: 'warn', action: 'cierre', text: lastC ? 'Pasaron ' + n + ' días desde el último cierre.' : 'Todavía no hiciste ningún cierre (' + n + ' días desde tu primer movimiento).' });
    }
    const bref = S.settings.lastBackup || S.settings.createdAt;
    if (bref && diffDays(bref, today) > 7)
      out.push({ kind: 'info', action: 'respaldo', text: S.settings.lastBackup ? 'Pasaron ' + diffDays(bref, today) + ' días desde tu último respaldo.' : 'Todavía no hiciste ningún respaldo.' });
    return out;
  }
  function sortedForList(list) {
    const open = list.filter((p) => p.status === 'open').sort((a, b) => (maturity(a) < maturity(b) ? -1 : 1));
    const paid = list.filter((p) => p.status === 'paid').sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1));
    return open.concat(paid);
  }
  function filterPlacements(S, f, today) {
    return sortedForList(S.placements.filter((p) => {
      const mat = maturity(p);
      if (f.estado === 'curso' && !(p.status === 'open' && mat >= today)) return false;
      if (f.estado === 'vencidas' && !(p.status === 'open' && mat < today)) return false;
      if (f.estado === 'cobradas' && p.status !== 'paid') return false;
      if (f.desde && mat < f.desde) return false;
      if (f.hasta && mat > f.hasta) return false;
      return true;
    }));
  }
  const weekStart = (n) => n - ((n + 3) % 7); // lunes (el día 0 fue jueves)
  function collections(S, mode, today, maxBars) {
    maxBars = maxBars || 12;
    const open = S.placements.filter((p) => p.status === 'open');
    const todayN = parseDate(today);
    let late = 0;
    const map = new Map();
    const keyOf = (dateStr) => {
      const n = parseDate(dateStr);
      if (mode === 'mes') return dateStr.slice(0, 7);
      return String(weekStart(n));
    };
    for (const p of open) {
      const mat = maturity(p);
      if (mat < today) { late += p.total; continue; }
      const k = keyOf(mat);
      map.set(k, (map.get(k) || 0) + p.total);
    }
    const bars = [];
    if (late > 0) bars.push({ label: 'Vencidas', value: late, late: true });
    if (map.size) {
      if (mode === 'mes') {
        let [y, m] = today.slice(0, 7).split('-').map(Number);
        const last = Array.from(map.keys()).sort().pop();
        for (let i = 0; i < 240; i++) {
          const k = y + '-' + pad(m);
          if (k > last) break;
          bars.push({ label: pad(m) + '/' + String(y).slice(2), value: map.get(k) || 0 });
          if (++m > 12) { m = 1; y++; }
        }
      } else {
        const last = Math.max(...Array.from(map.keys()).map(Number));
        for (let w = weekStart(todayN); w <= last; w += 7) {
          const s = dayToStr(w);
          bars.push({ label: s.slice(8) + '/' + s.slice(5, 7), value: map.get(String(w)) || 0 });
        }
      }
    }
    return { bars: bars.slice(0, maxBars), truncated: bars.length > maxBars };
  }

  /* ---------- Validación de respaldo ---------- */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const MKEYS = ['colocado', 'recuperado', 'ganancia', 'reinvertido', 'retirado', 'aportes', 'disponible', 'enCurso'];

  function validateData(o) {
    const err = (m) => ({ ok: false, error: m });
    if (!o || typeof o !== 'object') return err('El archivo no tiene el formato esperado.');
    if (!Array.isArray(o.placements) || !Array.isArray(o.movements) || !Array.isArray(o.closings))
      return err('Faltan las listas de colocaciones, movimientos o cierres.');
    if (o.placements.length > 20000 || o.movements.length > 20000 || o.closings.length > 5000) return err('El archivo tiene demasiados datos.');
    const placements = [], movements = [], closings = [];
    const ids = new Set();
    for (let i = 0; i < o.placements.length; i++) {
      const p = o.placements[i], w = 'Colocación ' + (i + 1) + ': ';
      if (!p || typeof p !== 'object') return err(w + 'dato inválido.');
      if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) return err(w + 'identificador inválido o repetido.');
      ids.add(p.id);
      const q = {
        id: p.id, capital: num(p.capital), days: num(p.days), total: num(p.total), date: p.date,
        note: str(p.note, 80), status: p.status, paidDate: typeof p.paidDate === 'string' ? p.paidDate : null,
        fromBalance: p.fromBalance === true, linkedFrom: typeof p.linkedFrom === 'string' ? p.linkedFrom : null, sample: p.sample === true,
      };
      const e = checkPlacement(q);
      if (e.length) return err(w + e[0]);
      if (q.status !== 'open' && q.status !== 'paid') return err(w + 'estado inválido.');
      if (q.status === 'paid') { if (isNaN(parseDate(q.paidDate)) || q.paidDate < q.date) return err(w + 'fecha de cobro inválida.'); }
      else q.paidDate = null;
      placements.push(q);
    }
    for (const p of placements) if (p.linkedFrom && !ids.has(p.linkedFrom)) p.linkedFrom = null;
    const mids = new Set();
    for (let i = 0; i < o.movements.length; i++) {
      const m = o.movements[i], w = 'Movimiento ' + (i + 1) + ': ';
      if (!m || typeof m !== 'object') return err(w + 'dato inválido.');
      if (typeof m.id !== 'string' || !m.id || mids.has(m.id)) return err(w + 'identificador inválido o repetido.');
      mids.add(m.id);
      if (m.type !== 'withdraw' && m.type !== 'contribution') return err(w + 'tipo inválido.');
      if (!(num(m.amount) > 0)) return err(w + 'monto inválido.');
      if (isNaN(parseDate(m.date))) return err(w + 'fecha inválida.');
      movements.push({ id: m.id, type: m.type, amount: m.amount, date: m.date, note: str(m.note, 80) });
    }
    const cids = new Set();
    for (let i = 0; i < o.closings.length; i++) {
      const c = o.closings[i], w = 'Cierre ' + (i + 1) + ': ';
      if (!c || typeof c !== 'object') return err(w + 'dato inválido.');
      if (typeof c.id !== 'string' || !c.id || cids.has(c.id)) return err(w + 'identificador inválido o repetido.');
      cids.add(c.id);
      if (isNaN(parseDate(c.from)) || isNaN(parseDate(c.to)) || isNaN(parseDate(c.createdAt)) || c.from > c.to) return err(w + 'fechas inválidas.');
      if (!c.m || typeof c.m !== 'object') return err(w + 'faltan los totales.');
      const m = {};
      for (const k of MKEYS) { if (isNaN(num(c.m[k]))) return err(w + 'total "' + k + '" inválido.'); m[k] = c.m[k]; }
      if (!Array.isArray(c.upcoming) || c.upcoming.length > 20000) return err(w + 'lista de vencimientos inválida.');
      const upcoming = [];
      for (const u of c.upcoming) {
        if (!u || isNaN(parseDate(u.date)) || isNaN(num(u.capital)) || isNaN(num(u.total))) return err(w + 'vencimiento inválido.');
        upcoming.push({ date: u.date, capital: u.capital, total: u.total, note: str(u.note, 80) });
      }
      closings.push({ id: c.id, createdAt: c.createdAt, from: c.from, to: c.to, m, upcoming });
    }
    let cycleDays = null;
    if (o.cycleDays !== undefined) {
      if (!Number.isInteger(o.cycleDays) || o.cycleDays < 1 || o.cycleDays > 365) return err('La duración del período no es válida.');
      cycleDays = o.cycleDays;
    }
    return { ok: true, data: { placements, movements, closings, cycleDays } };
  }
  function validateImport(o) {
    if (!o || typeof o !== 'object' || o.app !== 'colocaciones') return { ok: false, error: 'El archivo no parece ser un respaldo de esta app.' };
    if (typeof o.version !== 'number' || o.version > 1) return { ok: false, error: 'La versión del respaldo no es compatible.' };
    return validateData(o);
  }
  function exportData(S, exportedAt) {
    return JSON.parse(JSON.stringify({
      app: 'colocaciones', version: 1, exportedAt: exportedAt || new Date().toISOString(),
      cycleDays: S.settings.cycleDays, placements: S.placements, movements: S.movements, closings: S.closings,
    }));
  }
  function toCSV(S) {
    const q = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas en planillas
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const n = (x) => String(x).replace('.', ',');
    const pc = (x) => n((x * 100).toFixed(4));
    const rows = [['tipo', 'fecha', 'capital_o_monto', 'plazo_dias', 'total_a_recibir', 'ganancia', 'rendimiento_plazo_%', 'tna_%', 'tem_%', 'vencimiento', 'estado', 'fecha_cobro', 'es_reinversion', 'nota']];
    for (const p of S.placements) {
      const m = metrics(p.capital, p.total, p.days);
      rows.push(['colocacion', fmtDate(p.date), n(p.capital), p.days, n(p.total), n(m.gain), pc(m.r), pc(m.tna), pc(m.tem), fmtDate(maturity(p)),
        p.status === 'paid' ? 'cobrada' : 'en curso', fmtDate(p.paidDate), p.linkedFrom ? 'si' : 'no', p.note]);
    }
    for (const x of S.movements)
      rows.push([x.type === 'withdraw' ? 'retiro' : 'aporte', fmtDate(x.date), n(x.amount), '', '', '', '', '', '', '', '', '', '', x.note]);
    for (const c of S.closings)
      rows.push(['cierre', fmtDate(c.to), '', '', '', '', '', '', '', '', '', '', '',
        'Período ' + fmtDate(c.from) + '-' + fmtDate(c.to) + ': colocado ' + n(c.m.colocado) + '; recuperado ' + n(c.m.recuperado) + '; ganancia cobrada ' + n(c.m.ganancia) +
        '; reinvertido ' + n(c.m.reinvertido) + '; retirado ' + n(c.m.retirado) + '; aportes ' + n(c.m.aportes) + '; disponible ' + n(c.m.disponible) + '; en curso ' + n(c.m.enCurso)]);
    return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
  }

  /* ---------- PIN: SHA-256 propio y sincrónico (no depende de crypto.subtle) ---------- */
  const PR = [];
  for (let n = 2; PR.length < 64; n++) if (PR.every((p) => n % p)) PR.push(n);
  const K256 = PR.map((p) => Math.floor((Math.cbrt(p) % 1) * 4294967296));
  const H256 = PR.slice(0, 8).map((p) => Math.floor((Math.sqrt(p) % 1) * 4294967296));
  function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const l = bytes.length;
    const buf = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor((l * 8) / 4294967296));
    dv.setUint32(buf.length - 4, (l * 8) >>> 0);
    const H = H256.slice(), w = new Uint32Array(64);
    for (let o = 0; o < buf.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }
  function hashPin(pin, salt) {
    let h = sha256(salt + ':' + pin);
    for (let i = 0; i < 2000; i++) h = sha256(h + salt + pin);
    return h;
  }
  const newSalt = () => uid() + uid();

  const api = {
    parseDate, dayToStr, todayStr, addDays, diffDays, fmtDate,
    parseNum, fmtNum, fmtTrim, fmtMoney, fmtPct, fmtCompact, daysText,
    metrics, maturity, placementView, simulate, checkSim, rateToDaily,
    emptyState, samplePlacements, balance, totals, checkPlacement, addPlacement, updatePlacement, deletePlacement,
    markPaid, addMovement, periodMetrics, nextClosingPeriod, makeClosing, closingChanged,
    alerts, filterPlacements, collections, validateData, validateImport, exportData, toCSV,
    sha256, hashPin, newSalt, uid,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
