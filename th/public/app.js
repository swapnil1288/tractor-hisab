'use strict';
/* Tractor Hisab client. Offline-first: every change is queued in a durable outbox (localStorage, per business)
   with a client UUID + idempotency key, sent strictly in order, and shown with its sync state. */
const B = window.Billing, P = window.I3;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
let lang = LS.get('th:lang', 'mr');
const t = (k, o) => { let s = (I18N[lang] || I18N.mr)[k] ?? I18N.mr[k] ?? k; if (o) for (const x in o) s = s.split('{' + x + '}').join(o[x]); return s; };
const te = c => (I18N[lang] || I18N.mr).e[c] || I18N.mr.e[c] || t('e').SERVER_ERROR || c;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = p => B.formatPaise(p || 0);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const nowMinuteISO = () => { const d = new Date(); d.setSeconds(0, 0); return d.toISOString(); }; // shown times and billed times always match
const nowHM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const dIST = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const hmIST = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';
const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T00:00:00+05:30' : d).toLocaleDateString(lang === 'en' ? 'en-IN' : lang + '-IN-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
const fmtMin = m => m == null ? '—' : t('hm', { h: Math.floor(m / 60), m: m % 60 });
const rateL = rt => ({ hour: t('perHour'), acre: t('perAcre'), trip: t('perTrip'), fixed: t('fixed') }[rt] || '');
const $ = (r, q) => r.querySelector(q), $$ = (r, q) => [...r.querySelectorAll(q)];
const L_ = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  home: L_('<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>'), users: L_('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/>'),
  list: L_('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>'), grid: L_('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  plus: L_('<path d="M12 5v14M5 12h14"/>'), back: L_('<path d="M15 18l-6-6 6-6"/>'), chev: L_('<path d="M9 6l6 6-6 6"/>'), x: L_('<path d="M6 6l12 12M18 6L6 18"/>'),
  search: L_('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'), phone: L_('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>'),
  pdf: L_('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/>'), edit: L_('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  play: L_('<path d="M7 4l13 8-13 8z"/>'), stop: L_('<rect x="6" y="6" width="12" height="12" rx="2"/>'), check: L_('<path d="M5 12l5 5 9-10"/>'), rupee: L_('<path d="M7 5h10M7 9.5h10M10 5c4 0 4 9-3 9l8 6"/>'),
  tractor: L_('<circle cx="7" cy="16" r="4"/><circle cx="18" cy="17.5" r="2.5"/><path d="M4 12V5h6l2 6h7.5v4.5M11 16h4.5M15 11V7"/>'), userPlus: L_('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M19 8v6M16 11h6"/>'),
  down: L_('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'), cloud: L_('<path d="M7 18a4.5 4.5 0 01-.7-8.95A6 6 0 0117.7 9 4.5 4.5 0 0117 18z"/>'), logout: L_('<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H4"/>'),
  chat: L_('<path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4.1-1.1z"/>'), globe: L_('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5s1-5.9 3.5-8.5"/>')
};
const AV = [['#E4F1E8', '#1F6F43'], ['#FFF1C7', '#7A5600'], ['#E8F0FB', '#174A9C'], ['#FDE4E2', '#A3261E'], ['#EDE4FB', '#5B3A9A'], ['#DDF5F3', '#13675F']];
const avatar = n => { let h = 0; for (const c of (n || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; const [bg, fg] = AV[h % AV.length]; const ini = (n || '?').trim().split(/\s+/).map(w => [...w][0]).slice(0, 2).join(''); return `<div class="avatar" style="background:${bg};color:${fg}" aria-hidden="true">${esc(ini)}</div>`; };
function toast(msg) { document.querySelectorAll('.toast').forEach(x => x.remove()); const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }

/* ================= API ================= */
async function api(method, path, body, key) {
  const headers = { 'X-Requested-With': 'tractor-hisab' };
  if (body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = key || uuid();
  let r;
  try { r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch (_) { throw { network: true, code: 'NETWORK' }; }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.blob();
  if (!r.ok) throw { status: r.status, code: (data && data.code) || 'SERVER_ERROR', details: data && data.details };
  return data;
}
function errText(e) {
  if (e && e.details && e.details.errors) return e.details.errors.map(te).join(' ');
  return te((e && e.code) || 'SERVER_ERROR');
}

/* ================= STATE ================= */
const S = { mode: 'owner', me: null, biz: null, snap: null, outbox: [], view: { name: 'home' }, loading: true, syncing: false, sessionExpired: false, online: navigator.onLine, ledgers: {} };
const k = n => `th:${S.biz}:${n}`;
function saveOutbox() { if (!LS.set(k('outbox'), S.outbox)) toast('Storage full'); }
let loadSeq = 0;

function overlay() {
  // Server snapshot + not-yet-synced outbox operations, so the owner sees what they entered offline.
  const s = JSON.parse(JSON.stringify(S.snap || { business: {}, tractors: [], implements: [], farmers: [], jobs: [], payments: [], statements: [] }));
  const F = id => s.farmers.find(f => f.id === id), J = id => s.jobs.find(j => j.id === id);
  const bal = (fid, d) => { const f = F(fid); if (!f) return; f.balancePaise += d; f.outstandingPaise = Math.max(0, f.balancePaise); f.creditPaise = Math.max(0, -f.balancePaise); f._pendingMoney = true; };
  for (const op of S.outbox) {
    const b = op.body || {}, pend = { _pending: op.status };
    switch (op.kind) {
      case 'farmer.create': s.farmers.push({ id: b.id, name: b.name, village: b.village, mobile: b.mobile || null, version: 1, farms: (b.farms || []).map(x => ({ ...x, farmer_id: b.id })), balancePaise: 0, outstandingPaise: 0, creditPaise: 0, ...pend }); break;
      case 'farmer.update': { const f = F(op.ref.id); if (f) Object.assign(f, { name: b.name ?? f.name, village: b.village ?? f.village, mobile: b.mobile === undefined ? f.mobile : b.mobile, version: (b.version || f.version) + 1, ...pend }); break; }
      case 'farm.create': { const f = F(op.ref.farmerId); if (f) f.farms.push({ id: b.id, name: b.name, farmer_id: f.id, ...pend }); break; }
      case 'tractor.create': s.tractors.push({ id: b.id, name: b.name, active: true, version: 1, ...pend }); break;
      case 'implement.create': s.implements.push({ id: b.id, name: b.name, rate_type: b.rateType, rate_paise: b.ratePaise, active: true, version: 1, ...pend }); break;
      case 'implement.update': { const i = s.implements.find(x => x.id === op.ref.id); if (i) Object.assign(i, { name: b.name ?? i.name, rate_paise: b.ratePaise ?? i.rate_paise, rate_type: b.rateType ?? i.rate_type, version: (b.version || i.version) + 1, ...pend }); break; }
      case 'business.update': Object.assign(s.business, { name: b.name ?? s.business.name, owner_name: b.ownerName ?? s.business.owner_name, village: b.village ?? s.business.village, upi: b.upi ?? s.business.upi, lang: b.lang ?? s.business.lang }); break;
      case 'job.create': {
        const impl = s.implements.find(i => i.id === b.implementId) || {};
        const rate = b.rateOverride ? b.rateOverride.ratePaise : impl.rate_paise;
        const j = { id: b.id, farmer_id: b.farmerId, farm_id: b.farmId || null, tractor_id: b.tractorId || null, implement_id: b.implementId, implement_name: impl.name, rate_type: impl.rate_type, standard_rate_paise: impl.rate_paise, applied_rate_paise: rate,
          rate_override_reason: b.rateOverride ? b.rateOverride.reason : null, status: b.mode === 'book' ? 'booked' : b.mode === 'start' ? 'running' : 'completed', scheduled_date: b.scheduledDate || null, start_at: b.startAt || null, end_at: b.endAt || null,
          break_minutes: b.breakMinutes || 0, qty_hundredths: b.qty ? B.qtyToHundredths(b.qty) : null, meter_start: b.meterStart ?? null, meter_end: b.meterEnd ?? null, meter_reset: !!b.meterReset, meter_note: b.meterNote || null, version: 1, created_at: op.createdAt, ...pend };
        if (j.status === 'completed') { const p = previewOf(j); j.billable_minutes = p.billableMinutes; j.charge_paise = p.chargePaise; }
        s.jobs.unshift(j); break;
      }
      case 'job.start': { const j = J(op.ref.id); if (j) Object.assign(j, { status: 'running', start_at: b.startAt, meter_start: b.meterStart ?? j.meter_start, version: j.version + 1, ...pend }); break; }
      case 'job.complete': case 'job.update': { const j = J(op.ref.id); if (!j) break;
        Object.assign(j, { status: op.kind === 'job.complete' ? 'completed' : j.status, end_at: b.endAt ?? j.end_at, start_at: b.startAt ?? j.start_at, break_minutes: b.breakMinutes ?? j.break_minutes, meter_end: b.meterEnd ?? j.meter_end, meter_start: b.meterStart ?? j.meter_start,
          meter_reset: b.meterReset ?? j.meter_reset, meter_note: b.meterNote ?? j.meter_note, qty_hundredths: b.qty != null ? B.qtyToHundredths(b.qty) : j.qty_hundredths, version: j.version + 1, ...pend });
        const p = previewOf(j); j.billable_minutes = p.billableMinutes; j.charge_paise = p.chargePaise; break; }
      case 'job.confirm': { const j = J(op.ref.id); if (j && j.status !== 'confirmed') { j.status = 'confirmed'; j._pending = op.status; bal(j.farmer_id, b.expectedChargePaise); } break; }
      
      case 'job.delete': {
          const j = J(op.ref.id);

          if (j && ['booked', 'running', 'completed', 'confirmed'].includes(j.status)) {
            if (j.status === 'confirmed') {
              bal(j.farmer_id, -j.charge_paise);
            }

            Object.assign(j, {
              status: 'cancelled',
              cancel_reason: '[deleted] ' + b.reason,
              ...pend
            });
          }

          break;
        }
      
      case 'job.cancel': { const j = J(op.ref.id); if (j) Object.assign(j, { status: 'cancelled', ...pend }); break; }
      case 'job.correct': { const j = J(op.ref.id); if (j) { j.status = 'superseded'; bal(j.farmer_id, -j.charge_paise); const n = { ...j, id: b.newId, status: 'confirmed', corrected_from: j.id, start_at: b.startAt ?? j.start_at, end_at: b.endAt ?? j.end_at, break_minutes: b.breakMinutes ?? j.break_minutes, qty_hundredths: b.qty != null ? B.qtyToHundredths(b.qty) : j.qty_hundredths, applied_rate_paise: b.ratePaise ?? j.applied_rate_paise, ...pend }; const p = previewOf(n); n.charge_paise = p.chargePaise; n.billable_minutes = p.billableMinutes; s.jobs.unshift(n); bal(j.farmer_id, p.chargePaise || 0); } break; }
      case 'payment.create': s.payments.unshift({ id: b.id, farmer_id: b.farmerId, amount_paise: b.amountPaise, mode: b.mode, reference: b.reference, paid_on: b.paidOn, note: b.note, status: 'active', created_at: op.createdAt, ...pend }); bal(b.farmerId, -b.amountPaise); break;
      case 'payment.void': { const p = s.payments.find(x => x.id === op.ref.id); if (p && p.status === 'active') { p.status = 'voided'; p._pending = op.status; bal(p.farmer_id, p.amount_paise); } break; }
    }
  }
  return s;
}
function previewOf(j) {
  const r = B.computeCharge({ rateType: j.rate_type, ratePaise: j.applied_rate_paise, startAt: j.start_at, endAt: j.end_at, breakMinutes: j.break_minutes, qtyHundredths: j.qty_hundredths });
  const m = B.checkMeter({ meterStart: j.meter_start, meterEnd: j.meter_end, meterReset: j.meter_reset, meterNote: j.meter_note });
  return { ...r, ok: r.ok && m.ok, errors: [...r.errors, ...m.errors], meterHours: m.meterHours };
}

/* ================= OUTBOX & SYNC ================= */
function enqueue(kind, method, path, body, ref) {
  const op = { key: uuid(), kind, method, path, body, ref: ref || {}, status: 'pending', createdAt: new Date().toISOString() };
  S.outbox.push(op); saveOutbox(); render(); flush(); return op;
}
let retryTimer = null, backoff = 2000;
function scheduleRetry() { clearTimeout(retryTimer); retryTimer = setTimeout(flush, backoff); backoff = Math.min(backoff * 2, 60000); }
async function flush() {
  if (S.syncing || S.mode !== 'owner' || !S.biz) return;
  S.syncing = true; paintSync();
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      if (op.status === 'failed' || op.status === 'conflict') break; // strict order: later ops may depend on this one
      op.status = 'sending'; saveOutbox(); paintSync();
      try {
        await api(op.method, op.path, op.body, op.key);
        S.outbox.shift(); saveOutbox(); backoff = 2000; S.sessionExpired = false;
      } catch (e) {
        if (e.network || e.status >= 500 || e.status === 429) { op.status = 'pending'; saveOutbox(); scheduleRetry(); break; }
        if (e.status === 401) { op.status = 'pending'; saveOutbox(); S.sessionExpired = true; break; }
        if (e.status === 409 && (e.code === 'ALREADY_CONFIRMED' || e.code === 'ALREADY_VOIDED')) { S.outbox.shift(); saveOutbox(); continue; } // already applied elsewhere
        op.status = e.status === 409 ? 'conflict' : 'failed'; op.error = { code: e.code, details: e.details, status: e.status }; saveOutbox(); break;
      }
    }
    if (!S.outbox.length && !S.sessionExpired) await refresh();
  } finally { S.syncing = false; render(); }
}
async function refresh() {
  const my = ++loadSeq, biz = S.biz;
  try {
    const data = await api('GET', '/api/snapshot');
    if (my !== loadSeq || biz !== S.biz || data.business.id !== S.biz) return; // a newer load or another account won
    S.snap = data; LS.set(k('snap'), data); S.online = true;
  } catch (e) { if (e.status === 401) S.sessionExpired = true; if (e.network) S.online = false; }
}
function syncState() {
  const n = S.outbox.length, c = S.outbox.filter(o => o.status === 'conflict').length, f = S.outbox.filter(o => o.status === 'failed').length;
  if (S.loading && !S.snap) return ['loading', t('syncLoading')];
  if (c) return ['conflict', t('syncConflict', { n: c })];
  if (f) return ['failed', t('syncFailed', { n: f })];
  if (S.outbox.some(o => o.status === 'sending')) return ['saving', t('syncSaving')];
  if (n) return [navigator.onLine ? 'pending' : 'offline', navigator.onLine ? t('syncPending', { n }) : t('syncOffline') + ' · ' + n];
  if (!navigator.onLine) return ['offline', t('syncOffline')];
  return ['synced', t('syncSynced')];
}
function paintSync() { const el = document.getElementById('syncb'); if (!el) return; const [cls, txt] = syncState(); el.className = 'st ' + cls; el.innerHTML = '<i></i>' + esc(txt); el.setAttribute('aria-label', t('outbox') + ': ' + txt); }
addEventListener('online', () => { S.online = true; backoff = 2000; flush(); paintSync(); });
addEventListener('offline', () => { S.online = false; paintSync(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });

/* ================= SHELL ================= */
const V = () => S.view;
function go(name, id) { S.view = { name, id }; render(); window.scrollTo(0, 0); }
function bar(o) {
  return `<header class="bar"><div class="bar-in">${o.back ? `<button class="ib" data-go="${o.back}" aria-label="${t('back')}">${I.back}</button>` : `<span class="logo" aria-hidden="true"><img src="/icons/logo.svg" alt="" width="38" height="38"></span>`}
  <div class="bar-t"><h1>${esc(o.title)}</h1>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div>${o.noSync ? '' : `<button class="st" id="syncb" data-act="outbox"></button>`}${o.actions || ''}</div></header>`;
}
function nav() {
  const n = { farmer: 'farmers' }[V().name] || V().name;
  const b = (k, ic, lb) => `<button data-go="${k}" class="${n === k ? 'on' : ''}" ${n === k ? 'aria-current="page"' : ''}>${ic}<span>${lb}</span></button>`;
  return `<nav class="nav" aria-label="${t('app')}"><div class="nav-in">${b('home', I.home, t('home'))}${b('farmers', I.users, t('farmers'))}<button class="fab-w" data-act="quick"><span class="fab">${I.plus}</span><span>${t('add')}</span></button>${b('entries', I.list, t('entries'))}${b('more', I.grid, t('more'))}</div></nav>`;
}
function bindAll(root) {
  $$(root, '[data-go]').forEach(b => b.onclick = () => go(b.dataset.go, b.dataset.id));
  $$(root, '[data-act]').forEach(b => b.onclick = e => { e.stopPropagation(); ACT[b.dataset.act] && ACT[b.dataset.act](b.dataset); });
}
function render() {
  const app = document.getElementById('app');
  if (S.mode === 'farmer') return renderFarmer(app);
  if (!S.biz) { app.innerHTML = S.loading ? '<div class="spin" role="status" aria-label="' + t('loading') + '"></div>' : viewAuth(); bindAuth(app); return; }
  const s = overlay();
  if (needsSetup(s)) { app.innerHTML = viewSetup(s); bindSetup(app, s); return; }
  const views = { home: viewHome, farmers: viewFarmers, farmer: viewFarmer, entries: viewEntries, more: viewMore };
  app.innerHTML = (S.sessionExpired ? '' : '') + (views[V().name] || viewHome)(s) + nav();
  if (S.sessionExpired) $(app, 'main').insertAdjacentHTML('afterbegin', `<div class="banner err" role="alert">${t('sessionExpired')}<button class="btn sm pri" data-act="relogin">${t('loginBtn')}</button></div>`);
  bindAll(app); paintSync(); tick();
  if (V().name === 'home') bindHomeBookings(app);
  if (V().name === 'farmers') bindFarmers(app, s);
  if (V().name === 'farmer') loadLedger(V().id);
}
let tickT = null;
function tick() { clearInterval(tickT); const els = $$(document, '[data-since]'); if (!els.length) return; const f = () => els.forEach(e => { const m = Math.max(0, Math.floor((Date.now() - new Date(e.dataset.since)) / 1000)); e.textContent = `${Math.floor(m / 3600)}:${String(Math.floor(m / 60) % 60).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }); f(); tickT = setInterval(f, 1000); }

/* ================= AUTH ================= */
let authMode = 'login';
function langSeg() { return `<div class="lang">${['mr', 'hi', 'en'].map(l => `<button class="fchip ${lang === l ? 'on' : ''}" data-lang="${l}">${{ mr: 'मराठी', hi: 'हिंदी', en: 'English' }[l]}</button>`).join('')}</div>`; }
function viewAuth() {
  const reg = authMode === 'register';
  return `<main class="auth"><img class="logo" src="/icons/logo.svg" alt=""><h1>${t('app')}</h1><p class="sub">${t('ownerSub')}</p>${langSeg()}
  <form class="card form" id="authF" novalidate>
   ${reg ? `<label class="field"><span>${t('businessName')}</span><input class="in" name="businessName" required autocomplete="organization"></label><label class="field"><span>${t('ownerName')}</span><input class="in" name="ownerName" required autocomplete="name"></label><label class="field"><span>${t('village')}</span><input class="in" name="village"></label>` : ''}
   <label class="field"><span>${t('mobile')}</span><div class="pre"><span>+91</span><input class="in num" name="mobile" inputmode="numeric" maxlength="10" autocomplete="tel-national" required></div></label>
   <label class="field"><span>${t('password')}</span><input class="in" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8">${reg ? `<p class="help">${t('passwordHint')}</p>` : ''}</label>
   ${reg ? `<label class="field"><span>${t('setupCode')}</span><input class="in" name="setupCode" autocomplete="off"></label>` : ''}
   <div id="authErr" role="alert"></div><button class="btn pri block" type="submit">${reg ? t('registerBtn') : t('loginBtn')}</button>
   <button class="btn ghost block" type="button" id="authSwitch">${reg ? t('haveAccount') : t('noAccount')}</button></form>
  <a class="btn sec block" href="/farmer" style="margin-top:16px">${t('farmerPortal')}</a></main>`;
}
function bindAuth(app) {
  $$(app, '[data-lang]').forEach(b => b.onclick = () => { lang = b.dataset.lang; LS.set('th:lang', lang); document.documentElement.lang = lang; render(); });
  const f = $(app, '#authF'); if (!f) return;
  $(app, '#authSwitch').onclick = () => { authMode = authMode === 'login' ? 'register' : 'login'; render(); };
  f.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const btn = $(f, 'button[type=submit]'); btn.disabled = true;
    try { await api('POST', authMode === 'register' ? '/api/auth/register' : '/api/auth/login', d); await boot(); }
    catch (err) { $(app, '#authErr').innerHTML = `<div class="note err">${esc(err.network ? te('NETWORK') : errText(err))}</div>`; btn.disabled = false; }
  };
}
async function boot() {
  S.loading = true; render();
  let me = null;
  try { me = await api('GET', '/api/auth/me'); } catch (e) { if (e.network) { const last = LS.get('th:lastBiz'); if (last) me = { kind: 'owner', business: { id: last }, offline: true }; } }
  if (me && me.kind === 'owner') {
    S.biz = me.business.id; LS.set('th:lastBiz', S.biz);
    S.snap = LS.get(k('snap'), null); S.outbox = LS.get(k('outbox'), []);
    S.outbox.forEach(o => { if (o.status === 'sending') o.status = 'pending'; }); // interrupted mid-send: replay safely with the same key
    S.sessionExpired = false;
    if (!me.offline) { lang = me.business.lang || lang; await refresh(); }
    S.loading = false; render(); flush();
  } else {
    const last = LS.get('th:lastBiz');
    if (last && LS.get(`th:${last}:outbox`, []).length) { S.biz = last; S.snap = LS.get(`th:${last}:snap`, null); S.outbox = LS.get(`th:${last}:outbox`, []); S.sessionExpired = true; S.loading = false; render(); return; }
    S.biz = null; S.loading = false; render();
  }
}

/* ================= SETUP WIZARD ================= */
const SUPPLIED = [['नागर', '1200'], ['सिंगल पलटी नागर', '1100'], ['रोटर', '1200'], ['फणी', '1000'], ['सरी', '800'], ['सारे', '800'], ['पेरणी', '800'], ['बारीक रोटर', '900']];
let setupStep = 1;
const needsSetup = s => !s.tractors.length || !s.implements.length;
function viewSetup(s) {
  const st = `<div class="steps">${[1, 2, 3].map(i => `<i class="${i <= setupStep ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (setupStep === 1) body = `<h2 class="sec">${t('setup1')}</h2><div class="card form"><label class="field"><span>${t('businessName')}</span><input class="in" id="bn" value="${esc(s.business.name)}"></label>
    <label class="field"><span>${t('ownerName')}</span><input class="in" id="bo" value="${esc(s.business.owner_name)}"></label><label class="field"><span>${t('village')}</span><input class="in" id="bv" value="${esc(s.business.village || '')}"></label>
    <label class="field"><span>${t('upiId')}</span><input class="in" id="bu" value="${esc(s.business.upi || '')}" autocapitalize="off" placeholder="name@bank"></label></div>`;
  if (setupStep === 2) body = `<h2 class="sec">${t('setup2')}</h2><div class="card form"><label class="field"><span>${t('tractor')}</span><input class="in" id="tn" value="${s.tractors[0] ? esc(s.tractors[0].name) : 'ओमकार सोनालिका'}"></label></div>`;
  if (setupStep === 3) body = `<h2 class="sec">${t('setup3')}</h2><p class="help">${t('setupImplHelp')}</p><div class="card form" id="implList">${SUPPLIED.map(([n, r], i) => `<div class="impl-row"><input type="checkbox" checked data-i="${i}" aria-label="${esc(n)}"><input class="in" data-n="${i}" value="${esc(n)}" aria-label="${t('implement')}"><input class="in num" data-r="${i}" value="${r}" inputmode="decimal" aria-label="${t('rate')} ₹ ${t('perHour')}"></div>`).join('')}<p class="help">₹ ${t('perHour')}</p></div><div id="setErr"></div>`;
  return `${bar({ title: t('setupTitle'), noSync: true })}<main class="wrap">${st}${body}<div class="act2">${setupStep > 1 ? `<button class="btn sec" id="sb">${t('back')}</button>` : '<span></span>'}<button class="btn pri" id="sn">${setupStep < 3 ? t('next') : t('finish')}</button></div></main>`;
}
function bindSetup(app, s) {
  const sb = $(app, '#sb'); if (sb) sb.onclick = () => { setupStep--; render(); };
  $(app, '#sn').onclick = () => {
    if (setupStep === 1) { enqueue('business.update', 'PUT', '/api/business', { name: $(app, '#bn').value, ownerName: $(app, '#bo').value, village: $(app, '#bv').value, upi: $(app, '#bu').value, lang }); setupStep = 2; return render(); }
    if (setupStep === 2) { const n = $(app, '#tn').value.trim(); if (!n) return; if (!s.tractors.length) enqueue('tractor.create', 'POST', '/api/tractors', { id: uuid(), name: n }); setupStep = 3; return render(); }
    const rows = $$(app, '[data-i]').filter(c => c.checked).map(c => { const i = c.dataset.i; return { name: $(app, `[data-n="${i}"]`).value.trim(), paise: B.rupeesToPaise($(app, `[data-r="${i}"]`).value) }; });
    if (!rows.length || rows.some(r => !r.name || !r.paise)) { $(app, '#setErr').innerHTML = `<div class="note err">${te('RATE_INVALID')}</div>`; return; }
    rows.forEach(r => enqueue('implement.create', 'POST', '/api/implements', { id: uuid(), name: r.name, rateType: 'hour', ratePaise: r.paise }));
    setupStep = 1; go('home');
  };
}

/* ================= OWNER VIEWS ================= */
const stOf = f => f.balancePaise > 0 ? 'due' : f.balancePaise < 0 ? 'adv' : 'clear';
const pendTag = x => x && x._pending ? ` <span class="badge">${t('pendingTag')}</span>` : '';
const statusChip = j => `<span class="chip ${{ confirmed: 'ok', completed: 'partial', running: 'partial', booked: 'adv', cancelled: 'due', superseded: 'due' }[j.status]}">${t({ booked: 'bookedS' }[j.status] || j.status)}</span>`;
function jobRow(j, s, showFarmer) {
  const f = s.farmers.find(x => x.id === j.farmer_id), farm = f && f.farms.find(x => x.id === j.farm_id);
  const when = j.start_at ? `${fmtDate(dIST(j.start_at))} · ${hmIST(j.start_at)}${j.end_at ? '–' + hmIST(j.end_at) : ''}` : fmtDate(j.scheduled_date);
  return `<button class="row" data-act="job" data-id="${j.id}"><span class="pic">${P.tractor}</span><span class="row-m"><span class="row-t">${esc(j.implement_name)}${farm ? ' · ' + esc(farm.name) : ''}${pendTag(j)}</span><span class="row-s">${esc([showFarmer && f ? f.name : null, when].filter(Boolean).join(' · '))}</span></span>
   <span class="row-e"><b class="num">${j.charge_paise != null && j.status !== 'cancelled' ? money(j.charge_paise) : ''}</b>${statusChip(j)}</span></button>`;
}
function payRow(p, s, showFarmer) {
  const f = s.farmers.find(x => x.id === p.farmer_id);
  return `<button class="row" data-act="payment" data-id="${p.id}"><span class="pic">${P.cash}</span><span class="row-m"><span class="row-t">${t('payment')} · ${t(p.mode)}${pendTag(p)}</span><span class="row-s">${esc([showFarmer && f ? f.name : null, fmtDate(p.paid_on), p.reference].filter(Boolean).join(' · '))}</span></span>
   <span class="row-e"><b class="num ${p.status === 'voided' ? 'muted' : 'c-ok'}" ${p.status === 'voided' ? 'style="text-decoration:line-through"' : ''}>${money(p.amount_paise)}</b>${p.status === 'voided' ? `<span class="chip due">${t('cancelled')}</span>` : ''}</span></button>`;
}

let homeBookingDate = '';

function homeBookings(s) {
  const today = todayIST();

  const upcoming = s.jobs
    .filter(j => j.status === 'booked' && j.scheduled_date >= today)
    .sort((a, b) =>
      a.scheduled_date.localeCompare(b.scheduled_date) ||
      String(a.id).localeCompare(String(b.id))
    );

  const visible = homeBookingDate
    ? upcoming.filter(j => j.scheduled_date === homeBookingDate)
    : upcoming;

  const groups = new Map();
  visible.forEach(j => {
    if (!groups.has(j.scheduled_date)) groups.set(j.scheduled_date, []);
    groups.get(j.scheduled_date).push(j);
  });

  return `
    <section class="booking-section">
      <h2 class="sec">${t('upcomingBookings')}</h2>

      <div class="card booking-filter">
        <label class="field">
          <span>${t('filterBookingDate')}</span>
          <input class="in" type="date" id="homeBookingDate"
            min="${today}" value="${esc(homeBookingDate)}">
        </label>

        <button class="fchip ${homeBookingDate ? '' : 'on'}"
          id="allUpcomingBookings" type="button">
          ${t('allUpcoming')}
        </button>

        <p class="booking-count" role="status" aria-live="polite">
          ${t('totalBookings')}: <b class="num">${visible.length}</b>
        </p>
      </div>

      ${visible.length
        ? [...groups].map(([date, jobs]) => `
            <h3 class="sec">
              ${fmtDate(date)}
              <span class="chip adv">${jobs.length}</span>
            </h3>
            <div class="list">
              ${jobs.map(j => jobRow(j, s, true)).join('')}
            </div>
          `).join('')
        : `<div class="card empty">
            <p>${t('noUpcomingBookings')}</p>
          </div>`}
    </section>`;
}

function bindHomeBookings(app) {
  const input = $(app, '#homeBookingDate');
  const reset = $(app, '#allUpcomingBookings');

  if (input) input.onchange = () => {
    homeBookingDate = input.value;
    render();
  };

  if (reset) reset.onclick = () => {
    homeBookingDate = '';
    render();
  };
}

function viewHome(s) {
  const out = s.farmers.reduce((a, f) => a + f.outstandingPaise, 0), rec = s.payments.filter(p => p.status !== 'voided').reduce((a, p) => a + p.amount_paise, 0), cr = s.farmers.reduce((a, f) => a + f.creditPaise, 0);
  const nOut = s.farmers.filter(f => f.outstandingPaise > 0).length, nCr = s.farmers.filter(f => f.creditPaise > 0).length;
  const running = s.jobs.filter(j => j.status === 'running');
  const awaitingConfirm = s.jobs.filter(j => j.status === 'completed');
  const confirmed = s.jobs.filter(j => j.status === 'confirmed');
  
  const top = s.farmers.filter(f => f.outstandingPaise > 0).sort((a, b) => b.outstandingPaise - a.outstandingPaise).slice(0, 4);
  const pendMoney = s.farmers.some(f => f._pendingMoney);
  return bar({ title: s.business.name || t('app'), sub: s.business.owner_name ? `${t('hello')}, ${s.business.owner_name}` : '' }) + `<main class="wrap">
  <section class="hero" aria-label="${t('outstanding')}"><div class="hero-g3"><div><div class="hero-l">${t('outstanding')}</div><div class="hero-a num">${money(out)}</div><div class="hero-s">${t('fromN', { n: nOut })}</div></div>
   <div><div class="hero-l">${t('received')}</div><div class="hero-a num" style="font-size:28px">${money(rec)}</div><div class="hero-s">${t('forN', { n: s.payments.filter(p => p.status !== 'voided').length || 0 })}</div></div>
   <div><div class="hero-l">${t('credit')}</div><div class="hero-a num" style="font-size:28px">${money(cr)}</div><div class="hero-s">${t('forN', { n: nCr })}</div></div></div>${pendMoney ? `<div class="hero-s" style="margin-top:8px">* ${t('pendingBal')}</div>` : ''}</section>
  <div class="cta2"><button class="cta work" data-act="work"><span class="cta-i">${P.tractor}</span><span>${t('newWork')}</span></button><button class="cta pay" data-act="pay"><span class="cta-i">${P.cash}</span><span>${t('receivePay')}</span></button></div>
  ${homeBookings(s)}
  ${running.map(j => { const f = s.farmers.find(x => x.id === j.farmer_id); return `<div class="running"><span class="pic">${P.clock}</span><span class="row-m"><span class="row-t">${esc(f ? f.name : '')} · ${esc(j.implement_name)}${pendTag(j)}</span><span class="timer" data-since="${j.start_at}">0:00:00</span><span class="row-s">${t('start')} ${hmIST(j.start_at)}</span></span><button class="btn acc" data-act="finish" data-id="${j.id}">${I.stop}${t('finishWork')}</button></div>`; }).join('')}
 
  ${!s.farmers.length ? `<div class="card empty-hero" style="margin-top:16px">${P.field}<h2>${t('noFarmers')}</h2><button class="btn pri block" data-act="addFarmer">${I.userPlus}${t('addFirstFarmer')}</button></div>` : ''}
  </main>`;
}
let fSearch = '', fFilter = 'all';
function viewFarmers(s) {
  const c = { due: 0, adv: 0, clear: 0 }; s.farmers.forEach(f => c[stOf(f)]++);
  return bar({ title: t('farmers'), actions: `<button class="ib" data-act="addFarmer" aria-label="${t('addFarmer')}">${I.userPlus}</button>` }) + `<main class="wrap">
  <div class="search">${I.search}<input class="in" id="fs" type="search" placeholder="${t('search')}" value="${esc(fSearch)}" aria-label="${t('search')}"></div>
  <div class="chips" style="margin-bottom:14px">${[['all', t('all'), s.farmers.length], ['due', t('due'), c.due], ['adv', t('advance'), c.adv], ['clear', t('settled'), c.clear]].map(([k2, l, n]) => `<button class="fchip ${fFilter === k2 ? 'on' : ''}" data-ff="${k2}">${l}<span>${n}</span></button>`).join('')}</div>
  <div id="fl"></div></main>`;
}
function bindFarmers(app, s) {
  const draw = () => {
    const q = fSearch.trim().toLowerCase();
    const F = s.farmers.filter(f => (fFilter === 'all' || stOf(f) === fFilter) && (!q || [f.name, f.village, f.mobile].join(' ').toLowerCase().includes(q))).sort((a, b) => b.balancePaise - a.balancePaise || a.name.localeCompare(b.name));
    const el = $(app, '#fl');
    el.innerHTML = F.length ? `<div class="list">${F.map(f => `<button class="row" data-go="farmer" data-id="${f.id}">${avatar(f.name)}<span class="row-m"><span class="row-t">${esc(f.name)}${pendTag(f)}</span><span class="row-s">${esc([f.village, f.mobile].filter(Boolean).join(' · '))}</span></span><span class="row-e">${f.outstandingPaise ? `<b class="num c-due">${money(f.outstandingPaise)}</b><small>${t('due')}</small>` : f.creditPaise ? `<b class="num c-adv">${money(f.creditPaise)}</b><small>${t('advance')}</small>` : `<small class="c-ok">✓ ${t('settled')}</small>`}</span></button>`).join('')}</div>` : `<div class="card empty"><p>${t('noMatch')}</p></div>`;
    bindAll(el);
  };
  $(app, '#fs').oninput = e => { fSearch = e.target.value; draw(); };
  $$(app, '[data-ff]').forEach(b => b.onclick = () => { fFilter = b.dataset.ff; render(); });
  draw();
}
function viewFarmer(s) {
  const f = s.farmers.find(x => x.id === V().id);
  if (!f) return bar({ title: t('farmers'), back: 'farmers' }) + '<main class="wrap"></main>';
  const jobs = s.jobs.filter(j => j.farmer_id === f.id && ['booked', 'running', 'completed', 'confirmed'].includes(j.status));
  const awaitingConfirm = jobs.filter(j => j.status === 'completed');
  const confirmed = jobs.filter(j => j.status === 'confirmed');
  const booked = jobs.filter(j => j.status === 'booked');
  const received = s.payments.filter(p => p.farmer_id === f.id && p.status !== 'voided').reduce((a, p) => a + p.amount_paise, 0);
  const pend = S.outbox.filter(o => (o.body && (o.body.farmerId === f.id)) || (o.ref && o.ref.farmerId === f.id));
  return bar({ title: f.name, sub: f.village || '', back: 'farmers', actions: `<button class="ib" data-act="editFarmer" data-id="${f.id}" aria-label="${t('editFarmer')}">${I.edit}</button>` }) + `<main class="wrap">
  <section class="card prof">${avatar(f.name)}<div class="prof-t"><b>${esc(f.name)}</b><small>${esc([f.village, f.mobile].filter(Boolean).join(' · '))}</small></div>${f.mobile ? `<a class="ib round call" href="tel:+91${esc(f.mobile)}" aria-label="${t('mobile')}">${I.phone}</a>` : ''}</section>
  <section class="hero"><div class="hero-g3"><div><div class="hero-l">${t('outstanding')}</div><div class="hero-a num">${money(f.outstandingPaise)}</div></div><div><div class="hero-l">${t('received')}</div><div class="hero-a num" style="font-size:28px">${money(received)}</div></div><div><div class="hero-l">${t('credit')}</div><div class="hero-a num" style="font-size:28px">${money(f.creditPaise)}</div></div></div>${f._pendingMoney ? `<div class="hero-s" style="margin-top:6px">* ${t('pendingBal')}</div>` : ''}</section>
  <div class="act3"><button class="btn pri" data-act="work" data-farmer="${f.id}">${I.tractor}${t('newWork')}</button><button class="btn acc" data-act="pay" data-farmer="${f.id}">${I.rupee}${t('payment')}</button><button class="btn sec" data-act="statements" data-id="${f.id}">${I.pdf}${t('statement')}</button><button class="btn ghost" data-act="shareBill" data-id="${f.id}">WhatsApp</button></div>
  <div class="farms">${f.farms.map(x => `<span>${esc(x.name)}${x._pending ? ' *' : ''}</span>`).join('')}<button class="fchip" data-act="addFarm" data-id="${f.id}">${I.plus}${t('addFarm')}</button></div>
  ${awaitingConfirm.length ? `<h2 class="sec">${t('awaitingConfirm')}</h2><div class="list">${awaitingConfirm.map(j => jobRow(j, s)).join('')}</div>` : ''}
  ${confirmed.length ? `<h2 class="sec">${t('confirmed')}</h2><div class="list">${confirmed.map(j => jobRow(j, s)).join('')}</div>` : ''}
  ${booked.length ? `<h2 class="sec">${t('booked')}</h2><div class="list">${booked.map(j => jobRow(j, s)).join('')}</div>` : ''}
  ${pend.length ? `<h2 class="sec">${t('pendingTag')}</h2><div class="list">${pend.map(o => `<div class="row static"><span class="mi">${I.cloud}</span><span class="row-m"><span class="row-t">${esc(opLabel(o, s))}</span><span class="row-s">${t({ pending: 'opPending', sending: 'opSending', failed: 'opFailed', conflict: 'opConflict' }[o.status])}</span></span></div>`).join('')}</div>` : ''}
  <h2 class="sec">${t('ledger')}</h2><div id="ledger"><div class="spin"></div></div></main>`;
}
async function loadLedger(fid) {
  const el = document.getElementById('ledger'); if (!el) return;
  const draw = d => {
    if (!document.getElementById('ledger') || V().id !== fid) return;
    document.getElementById('ledger').innerHTML = d && d.rows.length ? `<div class="list">${[...d.rows].reverse().map(r => `<div class="row static"><span class="pic">${r.kind === 'payment' ? P.cash : r.kind === 'reversal' ? P.bill : P.tractor}</span><span class="row-m"><span class="row-t">${esc(r.detail)}</span><span class="row-s">${esc(fmtDate(r.date) + (r.sub ? ' · ' + r.sub : ''))}</span></span><span class="row-e"><b class="num ${r.credit ? 'c-ok' : ''}">${r.credit ? '−' + money(r.credit) : money(r.debit)}</b><small class="num">${t('closing')} ${money(r.balance)}</small></span></div>`).join('')}</div>` : `<div class="card empty"><p>${d ? t('none') : t('needOnline')}</p></div>`;
  };
  draw(S.ledgers[fid] || LS.get(k('ledger:' + fid), null));
  try { const d = await api('GET', `/api/farmers/${fid}/ledger`); S.ledgers[fid] = d; LS.set(k('ledger:' + fid), d); draw(d); } catch (_) { if (!S.ledgers[fid] && !LS.get(k('ledger:' + fid), null)) draw(null); }
}
let eTab = 'job';
function viewEntries(s) {
  const rows = eTab === 'job'
  ? s.jobs.filter(j =>
      j.status !== 'superseded' &&
      !(j.cancel_reason || '').startsWith('[deleted] ')
    )
  : s.payments;
  return bar({ title: t('entries') }) + `<main class="wrap"><div class="seg" role="tablist"><button data-et="job" class="${eTab === 'job' ? 'on' : ''}">${I.tractor}${t('newWork').split(' ').pop()}</button><button data-et="pay" class="${eTab === 'pay' ? 'on' : ''}">${I.rupee}${t('payment')}</button></div>
  ${rows.length ? `<div class="list">${rows.map(r => eTab === 'job' ? jobRow(r, s, true) : payRow(r, s, true)).join('')}</div>` : `<div class="card empty"><p>${t('none')}</p></div>`}</main>`;
}
function viewMore(s) {
  return bar({ title: t('more') }) + `<main class="wrap">
  <h3 class="grp">${t('business')}</h3><div class="list"><button class="row" data-act="bizEdit"><span class="mi">${I.edit}</span><span class="row-m"><span class="row-t">${esc(s.business.name)}</span><span class="row-s">${esc([s.business.owner_name, s.business.village, s.business.upi].filter(Boolean).join(' · '))}</span></span>${I.chev}</button></div>
  <h3 class="grp">${t('tractors')}</h3><div class="list">${s.tractors.map(x => `<div class="row static"><span class="pic">${P.tractor}</span><span class="row-m"><span class="row-t">${esc(x.name)}${pendTag(x)}</span></span></div>`).join('')}<button class="row" data-act="addTractor"><span class="mi">${I.plus}</span><span class="row-t">${t('addTractor')}</span></button></div>
  <h3 class="grp">${t('implements')}</h3><div class="list">${s.implements.map(x => `<button class="row" data-act="editImpl" data-id="${x.id}"><span class="row-m"><span class="row-t">${esc(x.name)}${pendTag(x)}</span><span class="row-s">${rateL(x.rate_type)}</span></span><b class="num">${money(x.rate_paise)}</b>${I.edit}</button>`).join('')}<button class="row" data-act="addImpl"><span class="mi">${I.plus}</span><span class="row-t">${t('addImpl')}</span></button></div>
  <h3 class="grp">${t('language')}</h3><div class="card form">${langSeg()}</div>
  <h3 class="grp">${t('outbox')}</h3><div class="list"><button class="row" data-act="outbox"><span class="mi">${I.cloud}</span><span class="row-m"><span class="row-t">${t('outbox')}</span><span class="row-s">${esc(syncState()[1])}</span></span>${I.chev}</button>
   <button class="row" data-act="questions"><span class="mi">${I.chat}</span><span class="row-t">${t('questions')}</span>${I.chev}</button>
   <button class="row" data-act="export"><span class="mi">${I.down}</span><span class="row-t">${t('exportData')}</span></button></div>
  <button class="btn danger block" data-act="logout" style="margin-top:22px">${I.logout}${t('logout')}</button>
  <p class="ver">${t('app')} · v4.0</p></main>`;
}

/* ================= SHEETS ================= */
function sheet(title, body, footer, onMount) {
  const layer = document.getElementById('layer'); const prev = document.activeElement;
  layer.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="iconbtn" data-close aria-label="${t('close')}">${I.x}</button></header><div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div></div>`;
  const sc = $(layer, '.scrim'); const close = () => { layer.innerHTML = '<div style="position:fixed;inset:0;z-index:70" aria-hidden="true"></div>'; setTimeout(() => { if (!layer.querySelector('.sheet')) layer.innerHTML = ''; }, 450); document.removeEventListener('keydown', escH); prev && prev.focus && prev.focus(); }; // absorb ghost taps from a double tap
  const escH = e => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', escH);
  sc.addEventListener('click', e => { if (e.target === sc) close(); }); $$(layer, '[data-close]').forEach(b => b.onclick = close);
  onMount && onMount(layer, close); return close;
}
const errBox = (el, e) => { el.innerHTML = `<div class="note err" role="alert">${esc(typeof e === 'string' ? e : errText(e))}</div>`; el.scrollIntoView({ block: 'center' }); };
function farmerPicker(host, s, initial, onChange) {
  let sel = initial || '', q = '';
  const draw = () => {
    const f = s.farmers.find(x => x.id === sel);
    if (f) { host.innerHTML = `<div class="fp-sel">${avatar(f.name)}<span class="row-m"><span class="row-t">${esc(f.name)}</span><span class="row-s">${esc(f.village || '')}${f.outstandingPaise ? ` · <span class="c-due">${t('due')} ${money(f.outstandingPaise)}</span>` : f.creditPaise ? ` · <span class="c-adv">${t('advance')} ${money(f.creditPaise)}</span>` : ''}</span></span><button type="button" class="link" data-c>${t('change')}</button></div>`; $(host, '[data-c]').onclick = () => { sel = ''; onChange(''); draw(); }; return; }
    host.innerHTML = `<div class="search">${I.search}<input class="in" type="search" placeholder="${t('search')}" value="${esc(q)}" autocomplete="off" aria-label="${t('farmer')}"></div><div class="fp-list"></div>`;
    const inp = $(host, 'input'); inp.oninput = () => { q = inp.value; list(); }; list();
  };
  const list = () => {
    const qq = q.trim().toLowerCase(), box = $(host, '.fp-list');
    const F = qq ? s.farmers.filter(f => [f.name, f.village, f.mobile].join(' ').toLowerCase().includes(qq)).slice(0, 6) : s.farmers.slice(0, 5);
    box.innerHTML = (!qq && F.length ? `<div class="fp-h">${t('recentF')}</div>` : '') + F.map(f => `<button type="button" class="fp-o" data-id="${f.id}">${avatar(f.name)}<span class="row-m"><span class="row-t">${esc(f.name)}</span><span class="row-s">${esc(f.village || '')}</span></span></button>`).join('') + (qq && !F.length ? `<div class="fp-h">${t('noMatch')}</div>` : '') + (qq ? `<button type="button" class="fp-o add" data-new><span class="mi">${I.userPlus}</span><span class="row-t">${esc(t('addNew', { q: q.trim() }))}</span></button>` : '');
    $$(box, '[data-id]').forEach(b => b.onclick = () => { sel = b.dataset.id; onChange(sel); draw(); });
    const nb = $(box, '[data-new]'); if (nb) nb.onclick = () => { const id = uuid(); enqueue('farmer.create', 'POST', '/api/farmers', { id, name: q.trim(), farms: [] }); s.farmers.unshift({ id, name: q.trim(), farms: [], balancePaise: 0, outstandingPaise: 0, creditPaise: 0 }); sel = id; q = ''; onChange(sel); draw(); };
  };
  draw();
}
const dt = (pre, d, tm) => `<div class="grid2"><label class="field"><span>${t(pre + 'Date')}</span><input class="in" type="date" id="${pre}D" value="${d}" max="${todayIST()}"></label><label class="field"><span>${t(pre)}</span><span class="timew"><input class="in num" type="time" id="${pre}T" value="${tm}"><button type="button" class="nowb" data-now="${pre}">${t('now')}</button></span></label></div>`;
const meterF = (j, both) => `<details class="ovr" ${j && (j.meter_start != null) ? 'open' : ''}><summary>${t('meterRef')}</summary><div class="grid2" style="margin-top:8px">${both !== 'end' ? `<label class="field"><span>${t('meterStart')}</span><input class="in num" id="ms" inputmode="decimal" value="${j && j.meter_start != null ? j.meter_start : ''}"></label>` : ''}${both !== 'start' ? `<label class="field"><span>${t('meterEnd')}</span><input class="in num" id="me" inputmode="decimal" value="${j && j.meter_end != null ? j.meter_end : ''}"></label>` : ''}</div>
  ${both !== 'start' ? `<label class="check"><input type="checkbox" id="mr" ${j && j.meter_reset ? 'checked' : ''}> ${t('meterReset')}</label><label class="field hide" id="mnW"><span>${t('meterNote')}</span><input class="in" id="mn" value="${esc(j && j.meter_note || '')}"></label>` : ''}</details>`;
function bindMeter(l) { const mr = $(l, '#mr'); if (mr) { const f = () => $(l, '#mnW').classList.toggle('hide', !mr.checked); mr.onchange = f; f(); } $$(l, '[data-now]').forEach(b => b.onclick = () => { $(l, '#' + b.dataset.now + 'D').value = todayIST(); $(l, '#' + b.dataset.now + 'T').value = nowHM(); l.dispatchEvent(new Event('input')); }); }
const lastMeter = (s, trId) => { const j = s.jobs.filter(x => x.tractor_id === trId && x.meter_end != null).sort((a, b) => new Date(b.end_at || 0) - new Date(a.end_at || 0))[0]; return j ? j.meter_end : ''; };

function openWork(d) {
  const s = overlay();
  const impls = s.implements.filter(i => i.active !== false), trs = s.tractors.filter(x => x.active !== false);
  let st = { farmerId: d && d.farmer || '', farmId: '', newFarm: '', implementId: impls[0] && impls[0].id, tractorId: trs[0] && trs[0].id, mode: 'now' };
  const body = `<section class="fs"><h4>${t('farmer')}</h4><div id="fp"></div><div id="farmBox"></div></section>
   <section class="fs"><h4>${t('implement')}</h4>${trs.length > 1 ? `<div class="chips" style="margin-bottom:8px">${trs.map(x => `<button type="button" class="fchip ${x.id === st.tractorId ? 'on' : ''}" data-tr="${x.id}">${I.tractor}${esc(x.name)}</button>`).join('')}</div>` : `<p class="help">${I.tractor} ${esc(trs[0] ? trs[0].name : '')}</p>`}
    <div class="impl">${impls.map(x => `<button type="button" class="ichip ${x.id === st.implementId ? 'on' : ''}" data-im="${x.id}"><b>${esc(x.name)}</b><small class="num">${money(x.rate_paise)} ${rateL(x.rate_type)}</small></button>`).join('')}</div>
    <div id="qtyW" class="hide" style="margin-top:12px"><label class="field"><span id="qtyL"></span><input class="in num big" id="qty" inputmode="decimal"></label></div>
    <details class="ovr" id="ovr"><summary>${t('override')}</summary><div style="margin-top:8px"><label class="field"><span>${t('overrideRate')}</span><input class="in num" id="ovRate" inputmode="decimal"></label><label class="field"><span>${t('overrideReason')}</span><input class="in" id="ovReason"></label><label class="check"><input type="checkbox" id="ovOk"> ${t('overrideConfirm')}</label><p class="help">${t('overrideNote')}</p></div></details></section>
   <section class="fs"><div class="seg" role="tablist">${[['now', t('modeNow')], ['book', t('modeBook')], ['past', t('modePast')]].map(([m, l]) => `<button type="button" data-mode="${m}" class="${st.mode === m ? 'on' : ''}">${l}</button>`).join('')}</div><p class="help" id="modeHelp"></p>
    <div id="mNow">${meterF(null, 'start')}</div>
    <div id="mBook" class="hide"><label class="field"><span>${t('scheduled')}</span><input class="in" type="date" id="sch" value="${todayIST()}"></label></div>
    <div id="mPast" class="hide">${dt('start', todayIST(), '')}${dt('end', todayIST(), '')}<label class="field"><span>${t('breakMin')}</span><input class="in num" id="brk" inputmode="numeric" placeholder="0"><p class="help">${t('breakHelp')}</p></label>${meterF(null)}</div></section>
   <div id="pv" aria-live="polite"></div><label class="field"><span>${t('note')}</span><input class="in" id="note"></label><div id="err"></div>`;
  sheet(t('newWork'), body, `<div class="ft-sum"><b class="num" id="ftA"></b><small id="ftS"></small></div><button class="btn pri" id="save"></button>`, (l, close) => {
    const impl = () => s.implements.find(i => i.id === st.implementId) || {};
    farmerPicker($(l, '#fp'), s, st.farmerId, v => { st.farmerId = v; st.farmId = ''; farmBox(); });
    function farmBox() {
      const f = s.farmers.find(x => x.id === st.farmerId), box = $(l, '#farmBox'); if (!f) { box.innerHTML = ''; return; }
      if (!st.farmId && f.farms.length === 1) st.farmId = f.farms[0].id;
      box.innerHTML = `<div class="chips">${f.farms.map(x => `<button type="button" class="fchip ${x.id === st.farmId ? 'on' : ''}" data-farm="${x.id}">${esc(x.name)}</button>`).join('')}<input class="in mini" id="nf" placeholder="${t('addFarm')}" aria-label="${t('farmName')}" style="width:150px" value="${esc(st.newFarm)}"></div>`;
      $$(box, '[data-farm]').forEach(b => b.onclick = () => { st.farmId = st.farmId === b.dataset.farm ? '' : b.dataset.farm; st.newFarm = ''; farmBox(); });
      $(box, '#nf').oninput = e => { st.newFarm = e.target.value; if (st.newFarm) { st.farmId = ''; $$(box, '[data-farm]').forEach(x => x.classList.remove('on')); } };
    }
    farmBox();
    const ms = $(l, '#mNow #ms'); if (ms && st.tractorId) ms.value = lastMeter(s, st.tractorId);
    $$(l, '[data-tr]').forEach(b => b.onclick = () => { st.tractorId = b.dataset.tr; $$(l, '[data-tr]').forEach(x => x.classList.toggle('on', x === b)); });
    $$(l, '[data-im]').forEach(b => b.onclick = () => { st.implementId = b.dataset.im; $$(l, '[data-im]').forEach(x => x.classList.toggle('on', x === b)); upd(); });
    $$(l, '[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; $$(l, '[data-mode]').forEach(x => x.classList.toggle('on', x === b)); upd(); });
    bindMeter($(l, '#mPast')); bindMeter($(l, '#mNow'));
    function rate() {
      const ov = $(l, '#ovr').open && $(l, '#ovRate').value ? B.rupeesToPaise($(l, '#ovRate').value) : null;
      return { ov, paise: ov || impl().rate_paise };
    }
    function pastJob() {
      const sa = B.istToISO($(l, '#startD').value, $(l, '#startT').value), ea = B.istToISO($(l, '#endD').value, $(l, '#endT').value);
      const brkV = $(l, '#brk').value.trim();
      return { rate_type: impl().rate_type, applied_rate_paise: rate().paise, start_at: sa, end_at: ea, break_minutes: brkV === '' ? 0 : (/^\d+$/.test(brkV) ? Number(brkV) : NaN), qty_hundredths: $(l, '#qty').value ? B.qtyToHundredths($(l, '#qty').value) : null,
        meter_start: $(l, '#mPast #ms').value || null, meter_end: $(l, '#mPast #me').value || null, meter_reset: $(l, '#mPast #mr').checked, meter_note: $(l, '#mPast #mn').value };
    }
    function upd() {
      const im = impl(), area = im.rate_type === 'acre' || im.rate_type === 'trip';
      $(l, '#qtyW').classList.toggle('hide', !area); $(l, '#qtyL').textContent = im.rate_type === 'trip' ? t('qtyTrip') : t('qtyAcre');
      ['Now', 'Book', 'Past'].forEach(m => $(l, '#m' + m).classList.toggle('hide', st.mode !== m.toLowerCase()));
      $(l, '#modeHelp').textContent = t({ now: 'modeNowHelp', book: 'modeBookHelp', past: 'modePastHelp' }[st.mode]);
      $(l, '#save').textContent = t({ now: 'saveStart', book: 'saveBook', past: 'savePast' }[st.mode]);
      if (st.mode === 'past') {
        const p = previewOf(pastJob());
        $(l, '#ftA').textContent = p.chargePaise != null ? money(p.chargePaise) : '—'; $(l, '#ftS').textContent = p.billableMinutes != null ? fmtMin(p.billableMinutes) : '';
        $(l, '#pv').innerHTML = (pastJob().start_at && pastJob().end_at) || area ? (p.ok ? `<div class="calc"><div class="r"><span>${t('duration')}</span><span class="num">${fmtMin(p.durationMinutes)}</span></div>${p.breakMinutes ? `<div class="r"><span>${t('breakMin')}</span><span class="num">− ${p.breakMinutes} ${t('minutes')}</span></div>` : ''}<div class="r"><b>${t('billable')}</b><b class="num">${fmtMin(p.billableMinutes)}</b></div></div>` : `<div class="note warn">${p.errors.map(te).join(' ')}</div>`) : '';
      } else { $(l, '#ftA').textContent = money(rate().paise); $(l, '#ftS').textContent = rateL(im.rate_type); $(l, '#pv').innerHTML = ''; }
    }
    l.addEventListener('input', upd); upd();
    $(l, '#save').onclick = () => {
      const err = $(l, '#err'); err.innerHTML = '';
      if (!st.farmerId) return errBox(err, te('FARMER_NOT_FOUND'));
      const im = impl(); const r = rate(); let rateOverride;
      if ($(l, '#ovr').open && $(l, '#ovRate').value) {
        if (!r.ov) return errBox(err, te('RATE_INVALID'));
        if ($(l, '#ovReason').value.trim().length < 5) return errBox(err, te('LENGTH') + ' (' + t('overrideReason') + ')');
        if (!$(l, '#ovOk').checked) return errBox(err, te('OVERRIDE_CONFIRM'));
        rateOverride = { ratePaise: r.ov, reason: $(l, '#ovReason').value.trim(), confirmed: true };
      }
      let farmId = st.farmId || null;
      if (st.newFarm.trim()) { farmId = uuid(); enqueue('farm.create', 'POST', `/api/farmers/${st.farmerId}/farms`, { id: farmId, name: st.newFarm.trim() }, { farmerId: st.farmerId }); }
      const base = { id: uuid(), farmerId: st.farmerId, farmId, implementId: im.id, tractorId: st.tractorId || null, note: $(l, '#note').value.trim() || undefined, rateOverride, qty: $(l, '#qty').value || undefined };
      if (st.mode === 'now') { const msv = $(l, '#mNow #ms').value; const m = B.checkMeter({ meterStart: msv }); if (!m.ok) return errBox(err, m.errors.map(te).join(' ')); enqueue('job.create', 'POST', '/api/jobs', { ...base, mode: 'start', startAt: nowMinuteISO(), meterStart: msv || undefined }, { farmerId: st.farmerId }); close(); toast(t('saved')); return; }
      if (st.mode === 'book') { enqueue('job.create', 'POST', '/api/jobs', { ...base, mode: 'book', scheduledDate: $(l, '#sch').value }, { farmerId: st.farmerId }); close(); toast(t('saved')); return; }
      const pj = pastJob(), p = previewOf(pj); if (!p.ok) return errBox(err, p.errors.map(te).join(' '));
      enqueue('job.create', 'POST', '/api/jobs', { ...base, mode: 'historical', startAt: pj.start_at, endAt: pj.end_at, breakMinutes: pj.break_minutes, meterStart: pj.meter_start || undefined, meterEnd: pj.meter_end || undefined, meterReset: pj.meter_reset, meterNote: pj.meter_note || undefined }, { farmerId: st.farmerId });
      close(); openConfirm(base.id);
    };
  });
}
function openFinish(id) {
  const s = overlay(), j = s.jobs.find(x => x.id === id); if (!j) return;
  const area = j.rate_type === 'acre' || j.rate_type === 'trip';
  sheet(t('finishWork'), `<div class="kvl"><div><span>${t('implement')}</span><b>${esc(j.implement_name)}</b></div><div><span>${t('start')}</span><b class="num">${fmtDate(dIST(j.start_at))} ${hmIST(j.start_at)}</b></div></div>
   ${dt('end', todayIST(), nowHM())}<label class="field"><span>${t('breakMin')}</span><input class="in num" id="brk" inputmode="numeric" placeholder="0" value="${j.break_minutes || ''}"><p class="help">${t('breakHelp')}</p></label>
   ${area ? `<label class="field"><span>${j.rate_type === 'trip' ? t('qtyTrip') : t('qtyAcre')}</span><input class="in num big" id="qty" inputmode="decimal"></label>` : ''}${meterF(j, 'end')}<div id="pv"></div><div id="err"></div>`,
   `<div class="ft-sum"><b class="num" id="ftA"></b><small id="ftS"></small></div><button class="btn pri" id="save">${t('preview')}</button>`, (l, close) => {
    bindMeter(l);
    const cur = () => { const bv = $(l, '#brk').value.trim(); return { ...j, end_at: B.istToISO($(l, '#endD').value, $(l, '#endT').value), break_minutes: bv === '' ? 0 : (/^\d+$/.test(bv) ? Number(bv) : NaN), qty_hundredths: area ? B.qtyToHundredths($(l, '#qty').value) : null, meter_end: $(l, '#me').value || null, meter_reset: $(l, '#mr').checked, meter_note: $(l, '#mn').value }; };
    const upd = () => { const p = previewOf(cur()); $(l, '#ftA').textContent = p.ok ? money(p.chargePaise) : '—'; $(l, '#ftS').textContent = p.ok && p.billableMinutes != null ? fmtMin(p.billableMinutes) : ''; $(l, '#pv').innerHTML = p.ok ? '' : `<div class="note warn">${p.errors.map(te).join(' ')}</div>`; };
    l.addEventListener('input', upd); upd();
    $(l, '#save').onclick = () => {
      const c = cur(), p = previewOf(c); if (!p.ok) return errBox($(l, '#err'), p.errors.map(te).join(' '));
      enqueue('job.complete', 'POST', `/api/jobs/${j.id}/complete`, { version: j.version, endAt: c.end_at, breakMinutes: c.break_minutes, qty: area ? $(l, '#qty').value : undefined, meterEnd: c.meter_end || undefined, meterReset: c.meter_reset, meterNote: c.meter_note || undefined }, { id: j.id, farmerId: j.farmer_id });
      close(); openConfirm(j.id);
    };
  });
}
function openConfirm(id) {
  const s = overlay(), j = s.jobs.find(x => x.id === id); if (!j) return;
  const f = s.farmers.find(x => x.id === j.farmer_id), farm = f && f.farms.find(x => x.id === j.farm_id), p = previewOf(j);
  sheet(t('preview'), `<div class="kvl"><div><span>${t('farmer')}</span><b>${esc(f ? f.name : '')}</b></div>${farm ? `<div><span>${t('farm')}</span><b>${esc(farm.name)}</b></div>` : ''}<div><span>${t('implement')}</span><b>${esc(j.implement_name)}</b></div>
   ${j.start_at ? `<div><span>${t('start')}</span><b class="num">${fmtDate(dIST(j.start_at))} ${hmIST(j.start_at)}</b></div><div><span>${t('end')}</span><b class="num">${fmtDate(dIST(j.end_at))} ${hmIST(j.end_at)}</b></div><div><span>${t('duration')}</span><b class="num">${fmtMin(p.durationMinutes)}</b></div><div><span>${t('breakMin')}</span><b class="num">${p.breakMinutes || 0} ${t('minutes')}</b></div>` : ''}
   ${p.billableMinutes != null ? `<div><span>${t('billable')}</span><b class="num">${fmtMin(p.billableMinutes)}</b></div>` : ''}${j.qty_hundredths ? `<div><span>${j.rate_type === 'trip' ? t('qtyTrip') : t('qtyAcre')}</span><b class="num">${j.qty_hundredths / 100}</b></div>` : ''}
   <div><span>${t('appliedRate')}</span><b class="num">${money(j.applied_rate_paise)} ${rateL(j.rate_type)}</b></div>${j.rate_override_reason ? `<div><span>${t('stdRate')}</span><b class="num">${money(j.standard_rate_paise)} · ${esc(j.rate_override_reason)}</b></div>` : ''}
   ${j.meter_start != null || j.meter_end != null ? `<div><span>${t('meterStart')} – ${t('meterEnd')}</span><b class="num">${j.meter_start ?? '—'} – ${j.meter_end ?? '—'}</b></div>` : ''}
   <div><span>${t('charge')}</span><b class="tot num">${p.ok ? money(p.chargePaise) : '—'}</b></div></div>
   ${p.ok ? `<p class="help">${t('confirmHelp')}</p>` : `<div class="note err">${p.errors.map(te).join(' ')}</div>`}`,
   `<button class="btn sec" data-act-x="edit">${t('edit')}</button><button class="btn pri" id="ok" ${p.ok ? '' : 'disabled'}>${I.check}${t('confirmCharge', { a: p.ok ? money(p.chargePaise) : '' })}</button>`, (l, close) => {
    $(l, '[data-act-x=edit]').onclick = () => { close(); openEdit(j.id); };
    $(l, '#ok').onclick = () => { $(l, '#ok').disabled = true; enqueue('job.confirm', 'POST', `/api/jobs/${j.id}/confirm`, { expectedChargePaise: p.chargePaise }, { id: j.id, farmerId: j.farmer_id }); close(); toast(t('confirmed') + ' · ' + money(p.chargePaise)); };
  });
}
function timesForm(j) { return `${dt('start', j.start_at ? dIST(j.start_at) : todayIST(), j.start_at ? hmIST(j.start_at) : '')}${dt('end', j.end_at ? dIST(j.end_at) : todayIST(), j.end_at ? hmIST(j.end_at) : '')}<label class="field"><span>${t('breakMin')}</span><input class="in num" id="brk" inputmode="numeric" value="${j.break_minutes || ''}" placeholder="0"></label>${j.rate_type === 'acre' || j.rate_type === 'trip' ? `<label class="field"><span>${t('qtyAcre')}</span><input class="in num" id="qty" inputmode="decimal" value="${j.qty_hundredths ? j.qty_hundredths / 100 : ''}"></label>` : ''}`; }
function readTimes(l, j) { const bv = $(l, '#brk').value.trim(); const q = $(l, '#qty'); return { start_at: B.istToISO($(l, '#startD').value, $(l, '#startT').value), end_at: B.istToISO($(l, '#endD').value, $(l, '#endT').value), break_minutes: bv === '' ? 0 : (/^\d+$/.test(bv) ? Number(bv) : NaN), qty: q ? q.value : undefined, qty_hundredths: q && q.value ? B.qtyToHundredths(q.value) : j.qty_hundredths }; }
function openEdit(id) {
  const s = overlay(), j = s.jobs.find(x => x.id === id); if (!j) return;
  sheet(t('edit'), `${timesForm(j)}${meterF(j)}<div id="pv"></div><div id="err"></div>`, `<div class="ft-sum"><b class="num" id="ftA"></b></div><button class="btn pri" id="save">${t('preview')}</button>`, (l, close) => {
    bindMeter(l);
    const cur = () => ({ ...j, ...readTimes(l, j), meter_start: $(l, '#ms').value || null, meter_end: $(l, '#me').value || null, meter_reset: $(l, '#mr').checked, meter_note: $(l, '#mn').value });
    const upd = () => { const p = previewOf(cur()); $(l, '#ftA').textContent = p.ok ? money(p.chargePaise) : '—'; $(l, '#pv').innerHTML = p.ok ? '' : `<div class="note warn">${p.errors.map(te).join(' ')}</div>`; };
    l.addEventListener('input', upd); upd();
    $(l, '#save').onclick = () => { const c = cur(), p = previewOf(c); if (!p.ok) return errBox($(l, '#err'), p.errors.map(te).join(' '));
      enqueue('job.update', 'PUT', `/api/jobs/${j.id}`, { version: j.version, startAt: c.start_at, endAt: c.end_at, breakMinutes: c.break_minutes, qty: c.qty, meterStart: c.meter_start, meterEnd: c.meter_end, meterReset: c.meter_reset, meterNote: c.meter_note || null }, { id: j.id, farmerId: j.farmer_id }); close(); openConfirm(j.id); };
  });
}
function openJob(id) {
  const s = overlay(), j = s.jobs.find(x => x.id === id); if (!j) return;
  if (j.status === 'completed') return openConfirm(id);
  if (j.status === 'running') return openFinish(id);
  const f = s.farmers.find(x => x.id === j.farmer_id);
  const acts = { booked: `<button class="btn sec" id="cx">${t('cancelJob')}</button><button class="btn pri" id="go">${I.play}${t('startNow')}</button>`, confirmed: `<button class="btn sec" id="cr">${I.edit}${t('correct')}</button>
<button class="btn danger" id="delJob">${t('deleteEntry')}</button>` }[j.status] || '';
  sheet(j.implement_name, `<div class="kvl"><div><span>${t('farmer')}</span><b>${esc(f ? f.name : '')}</b></div><div><span>${t('date')}</span><b>${fmtDate(j.start_at ? dIST(j.start_at) : j.scheduled_date)}</b></div>${j.start_at ? `<div><span>${t('start')}–${t('end')}</span><b class="num">${hmIST(j.start_at)}–${hmIST(j.end_at)}</b></div>` : ''}
   ${j.billable_minutes != null ? `<div><span>${t('billable')}</span><b class="num">${fmtMin(j.billable_minutes)}</b></div>` : ''}<div><span>${t('appliedRate')}</span><b class="num">${money(j.applied_rate_paise)} ${rateL(j.rate_type)}</b></div>
   ${j.charge_paise != null ? `<div><span>${t('charge')}</span><b class="tot num">${money(j.charge_paise)}</b></div>` : ''}<div><span></span>${statusChip(j)}</div></div>`, acts, (l, close) => {
    const go_ = $(l, '#go'); if (go_) go_.onclick = () => { enqueue('job.start', 'POST', `/api/jobs/${j.id}/start`, { version: j.version, startAt: nowMinuteISO(), meterStart: j.meter_start ?? (lastMeter(s, j.tractor_id) || undefined) }, { id: j.id, farmerId: j.farmer_id }); close(); };
    const cx = $(l, '#cx'); if (cx) cx.onclick = () => { close(); reasonSheet(t('cancelJob'), t('cancelReason'), r => enqueue('job.cancel', 'POST', `/api/jobs/${j.id}/cancel`, { reason: r }, { id: j.id, farmerId: j.farmer_id }), 3); };
    
    const del = $(l, '#delJob');

      if (del) del.onclick = () => {
        close();
        openDeleteJob(j.id);
      };
    
    const cr = $(l, '#cr'); if (cr) cr.onclick = () => { close(); openCorrect(j.id); };
  });
}

function openDeleteJob(id) {
  const s = overlay();
  const j = s.jobs.find(x => x.id === id);
  if (!j || j.status !== 'confirmed') return;

  const f = s.farmers.find(x => x.id === j.farmer_id);

  sheet(
    t('deleteEntry'),
    `<p class="help">${t('deleteEntryHelp')}</p>
     <div class="kvl">
       <div>
         <span>${t('farmer')}</span>
         <b>${esc(f ? f.name : '')}</b>
       </div>
       <div>
         <span>${t('implement')}</span>
         <b>${esc(j.implement_name)}</b>
       </div>
       <div>
         <span>${t('charge')}</span>
         <b>${money(j.charge_paise)}</b>
       </div>
     </div>
     <label class="field">
       <span>${t('deleteReason')}</span>
       <input class="in" id="deleteReason" maxlength="200">
     </label>
     <div id="err"></div>`,
    `<button class="btn sec" data-close>${t('cancel')}</button>
     <button class="btn danger" id="confirmDelete">
       ${t('deleteEntry')}
     </button>`,
    (l, close) => {
      $(l, '#confirmDelete').onclick = () => {
        const reason = $(l, '#deleteReason').value.trim();

        if (reason.length < 5) {
          return errBox($(l, '#err'), te('REQUIRED'));
        }

        $(l, '#confirmDelete').disabled = true;

        enqueue(
          'job.delete',
          'POST',
          `/api/jobs/${j.id}/delete`,
          { version: j.version, reason },
          { id: j.id, farmerId: j.farmer_id }
        );

        close();
      };
    }
  );
}

function openCorrect(id) {
  const s = overlay(), j = s.jobs.find(x => x.id === id);
  sheet(t('correct'), `<p class="help">${t('correctHelp')}</p>${timesForm(j)}<label class="field"><span>${t('appliedRate')} (₹)</span><input class="in num" id="rt" inputmode="decimal" value="${(j.applied_rate_paise / 100).toFixed(2)}"></label><label class="field"><span>${t('correctReason')}</span><input class="in" id="rs"></label><div id="pv"></div><div id="err"></div>`,
   `<div class="ft-sum"><b class="num" id="ftA"></b></div><button class="btn pri" id="save">${t('saveCorrection')}</button>`, (l, close) => {
    bindMeter(l);
    const cur = () => ({ ...j, ...readTimes(l, j), applied_rate_paise: B.rupeesToPaise($(l, '#rt').value) });
    const upd = () => { const p = previewOf(cur()); $(l, '#ftA').textContent = p.ok ? money(p.chargePaise) : '—'; $(l, '#pv').innerHTML = p.ok ? '' : `<div class="note warn">${p.errors.map(te).join(' ')}</div>`; };
    l.addEventListener('input', upd); upd();
    $(l, '#save').onclick = () => { const c = cur(), p = previewOf(c), rs = $(l, '#rs').value.trim(); if (!p.ok) return errBox($(l, '#err'), p.errors.map(te).join(' ')); if (rs.length < 5) return errBox($(l, '#err'), te('REQUIRED') + ' (' + t('correctReason') + ')');
      enqueue('job.correct', 'POST', `/api/jobs/${j.id}/correct`, { newId: uuid(), reason: rs, startAt: c.start_at, endAt: c.end_at, breakMinutes: c.break_minutes, qty: c.qty, ratePaise: c.applied_rate_paise }, { id: j.id, farmerId: j.farmer_id }); close(); };
  });
}
function reasonSheet(title, label, fn, min = 5) {
  sheet(title, `<label class="field"><span>${label}</span><input class="in" id="r"></label><div id="err"></div>`, `<button class="btn sec" data-close>${t('cancel')}</button><button class="btn danger" id="ok">${t('confirm')}</button>`, (l, close) => {
    $(l, '#ok').onclick = () => { const v = $(l, '#r').value.trim(); if (v.length < min) return errBox($(l, '#err'), te('REQUIRED')); fn(v); close(); };
  });
}
function openPay(d) {
  const s = overlay(); let fid = d && d.farmer || '', mode = 'cash';
  sheet(t('receivePay'), `<section class="fs"><h4>${t('farmer')}</h4><div id="fp"></div></section>
   <section class="fs"><h4>${t('amount')}</h4><label class="amt-in"><span>₹</span><input id="pa" class="num" inputmode="decimal" placeholder="0" aria-label="${t('amount')}"></label><div class="chips" id="qa"></div><p class="help">${t('payHelp')}</p></section>
   <section class="fs"><h4>${t('payMode')}</h4><div class="seg">${['cash', 'upi', 'cheque'].map(m => `<button type="button" data-m="${m}" class="${m === mode ? 'on' : ''}">${t(m)}</button>`).join('')}</div><label class="field hide" id="refW"><span>${t('reference')}</span><input class="in" id="ref"></label></section>
   <label class="field"><span>${t('paidOn')}</span><input class="in" type="date" id="pd" value="${todayIST()}" max="${todayIST()}"></label><label class="field"><span>${t('note')}</span><input class="in" id="pn"></label><div id="err"></div>`,
   `<div class="ft-sum"><small>${t('afterPay')}</small><b class="num" id="ftA">—</b></div><button class="btn acc" id="save">${t('save')}</button>`, (l, close) => {
    const upd = () => {
      const f = s.farmers.find(x => x.id === fid), amt = B.rupeesToPaise($(l, '#pa').value) || 0;
      if (!f) { $(l, '#ftA').textContent = '—'; $(l, '#qa').innerHTML = ''; return; }
      $(l, '#qa').innerHTML = f.outstandingPaise ? `<button type="button" class="fchip" data-a="${(f.outstandingPaise / 100).toFixed(2)}">${t('fullDue')} ${money(f.outstandingPaise)}</button>` : '';
      $$(l, '[data-a]').forEach(b => b.onclick = () => { $(l, '#pa').value = b.dataset.a; upd(); });
      const after = f.balancePaise - amt; const ft = $(l, '#ftA'); ft.className = 'num ' + (after > 0 ? 'c-due' : after < 0 ? 'c-adv' : 'c-ok');
      ft.textContent = after > 0 ? `${t('due')} ${money(after)}` : after < 0 ? `${t('advance')} ${money(-after)}` : '✓ ' + t('settled');
      $(l, '#save').textContent = amt ? t('savePay', { a: money(amt) }) : t('save');
    };
    farmerPicker($(l, '#fp'), s, fid, v => { fid = v; upd(); });
    $$(l, '[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; $$(l, '[data-m]').forEach(x => x.classList.toggle('on', x === b)); $(l, '#refW').classList.toggle('hide', mode === 'cash'); });
    $(l, '#pa').oninput = upd; upd();
    $(l, '#save').onclick = () => {
      const amt = B.rupeesToPaise($(l, '#pa').value), err = $(l, '#err');
      if (!fid) return errBox(err, te('FARMER_NOT_FOUND')); if (!amt) return errBox(err, te('INVALID') + ' (' + t('amount') + ')');
      const pd = $(l, '#pd').value; if (!pd || pd > todayIST()) return errBox(err, te('DATE_FUTURE'));
      $(l, '#save').disabled = true;
      enqueue('payment.create', 'POST', '/api/payments', { id: uuid(), farmerId: fid, amountPaise: amt, mode, reference: mode === 'cash' ? undefined : $(l, '#ref').value.trim() || undefined, paidOn: pd, note: $(l, '#pn').value.trim() || undefined }, { farmerId: fid });
      close(); toast(t('saved') + ' · ' + money(amt));
    };
  });
}
function openPayment(id) {
  const s = overlay(), p = s.payments.find(x => x.id === id); if (!p) return; const f = s.farmers.find(x => x.id === p.farmer_id);
  sheet(t('payment'), `<div class="kvl"><div><span>${t('farmer')}</span><b>${esc(f ? f.name : '')}</b></div><div><span>${t('paidOn')}</span><b>${fmtDate(p.paid_on)}</b></div><div><span>${t('payMode')}</span><b>${t(p.mode)}${p.reference ? ' · ' + esc(p.reference) : ''}</b></div><div><span>${t('amount')}</span><b class="tot num">${money(p.amount_paise)}</b></div>${p.void_reason ? `<div><span>${t('voidReason')}</span><b>${esc(p.void_reason)}</b></div>` : ''}</div>`,
   p.status === 'active' ? `<button class="btn danger block" id="vd" style="margin:0">${t('voidPay')}</button>` : '', (l, close) => {
    const vd = $(l, '#vd'); if (vd) vd.onclick = () => { close(); reasonSheet(t('voidPay'), t('voidReason'), r => enqueue('payment.void', 'POST', `/api/payments/${p.id}/void`, { reason: r }, { id: p.id, farmerId: p.farmer_id })); };
  });
}
function openFarmer(id) {
  const s = overlay(), f = id ? s.farmers.find(x => x.id === id) : null;
  sheet(f ? t('editFarmer') : t('addFarmer'), `<label class="field"><span>${t('name')}</span><input class="in" id="fn" value="${esc(f ? f.name : '')}"></label><label class="field"><span>${t('village')}</span><input class="in" id="fv" value="${esc(f ? f.village || '' : '')}"></label>
   <label class="field">
  <span>${t('mobileOpt')}</span>
  <div class="contact-input">
    <div class="pre">
      <span>+91</span>
      <input class="in num" id="fm" type="tel"
        inputmode="numeric" maxlength="10"
        value="${esc(f ? f.mobile || '' : '')}">
    </div>
    <button class="btn sec contact-btn" type="button" id="pickContact">
      ${I.users}<span>संपर्क</span>
    </button>
  </div>
</label>

   ${f ? '' : `<label class="field"><span>${t('farms')}</span><input class="in" id="ff" placeholder="${t('farmName')}, ${t('farmName')}"></label>`}<div id="err"></div>`,
   `<button class="btn sec" data-close>${t('cancel')}</button><button class="btn pri" id="save">${t('save')}</button>`, (l, close) => {
    $(l, '#pickContact').onclick = async () => {
  if (!window.isSecureContext ||
      !navigator.contacts ||
      typeof navigator.contacts.select !== 'function') {
    toast('या ब्राउझरमध्ये संपर्क निवडता येत नाही. नंबर कॉपी करून भरा.');
    $(l, '#fm').focus();
    return;
  }

  const button = $(l, '#pickContact');
  button.disabled = true;

  try {
    const contacts = await navigator.contacts.select(
      ['name', 'tel'],
      { multiple: false }
    );

    if (!contacts.length || !l.isConnected) return;

    const contact = contacts[0];

    const numbers = [...new Set((contact.tel || []).map(raw => {
      let number = String(raw).replace(/\D/g, '');
      if (number.startsWith('0091') && number.length === 14) {
        number = number.slice(4);
      } else if (number.startsWith('91') && number.length === 12) {
        number = number.slice(2);
      } else if (number.startsWith('0') && number.length === 11) {
        number = number.slice(1);
      }
      return number;
    }).filter(number => /^[6-9]\d{9}$/.test(number)))];

    if (!numbers.length) {
      toast('या संपर्कात वैध भारतीय मोबाइल नंबर नाही.');
      return;
    }

    let selected = numbers[0];

    if (numbers.length > 1) {
      const choice = window.prompt(
        'नंबर निवडा:\n' +
        numbers.map((number, i) => `${i + 1}. ${number}`).join('\n'),
        '1'
      );

      if (choice === null) return;

      const index = Number(choice) - 1;
      if (!Number.isInteger(index) || !numbers[index]) {
        toast('योग्य नंबर निवडा.');
        return;
      }

      selected = numbers[index];
    }

    $(l, '#fm').value = selected;

    if (!$(l, '#fn').value.trim() && contact.name?.[0]) {
      $(l, '#fn').value = contact.name[0];
    }

    $(l, '#fm').dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) {
    if (error.name !== 'AbortError') {
      toast('संपर्क उघडता आला नाही. नंबर manually भरा.');
    }
  } finally {
    button.disabled = false;
  }
};
    $(l, '#save').onclick = () => {
      const name = $(l, '#fn').value.trim(), mob = $(l, '#fm').value.replace(/\D/g, '');
      if (!name) return errBox($(l, '#err'), te('REQUIRED')); if (mob && !/^[6-9]\d{9}$/.test(mob)) return errBox($(l, '#err'), te('MOBILE_INVALID'));
      if (f) enqueue('farmer.update', 'PUT', `/api/farmers/${f.id}`, { version: f.version, name, village: $(l, '#fv').value.trim() || null, mobile: mob || null }, { id: f.id, farmerId: f.id });
      else { const nid = uuid(); enqueue('farmer.create', 'POST', '/api/farmers', { id: nid, name, village: $(l, '#fv').value.trim() || undefined, mobile: mob || undefined, farms: [...new Set($(l, '#ff').value.split(/[,،]/).map(x => x.trim()).filter(Boolean))].map(n => ({ id: uuid(), name: n })) }, { farmerId: nid }); close(); return go('farmer', nid); }
      close();
    };
  });
}
function openStatements(fid) {
  const s = overlay(), f = s.farmers.find(x => x.id === fid); let kind = 'all';
  const list = () => s.statements.filter(x => x.farmer_id === fid);
  sheet(t('statement') + ' · ' + f.name, `<div class="seg">${[['all', t('stAll')], ['range', t('stRange')], ['since_last', t('stSince')]].map(([kk, lb]) => `<button type="button" data-k="${kk}" class="${kk === kind ? 'on' : ''}">${lb}</button>`).join('')}</div>
   <div class="grid2 hide" id="rng"><label class="field"><span>${t('from')}</span><input class="in" type="date" id="sf" max="${todayIST()}"></label><label class="field"><span>${t('to')}</span><input class="in" type="date" id="stt" value="${todayIST()}" max="${todayIST()}"></label></div>
   <p class="help">${t('stHelp')}</p><div id="err"></div><button class="btn pri block" id="mk">${I.pdf}${t('makeStatement')}</button>
   <button class="btn ghost block" id="wshare" style="margin-top:8px">WhatsApp</button>
   <h3 class="grp">${t('statements')}</h3><div class="list" id="sl"></div>`, '', (l) => {
    const drawList = () => { const L2 = list(); $(l, '#sl').innerHTML = L2.length ? L2.map((x, i) => `<div class="row static"><span class="pic">${P.pdf}</span><span class="row-m"><span class="row-t">${x.from_date ? fmtDate(x.from_date) : t('stAll')} – ${fmtDate(x.to_date)}</span><span class="row-s">${t('closing')}: ${money(x.closing_paise)} · ${fmtDate(dIST(x.created_at))}</span></span><button class="btn sec sm" data-dl="${x.id}">${I.down}${LS.get('th:dl:' + x.id) ? t('reprint') : 'PDF'}</button></div>`).join('') : `<div class="empty"><p>${t('none')}</p></div>`;
      $$(l, '[data-dl]').forEach(b => b.onclick = () => downloadStatement(b.dataset.dl, f.name, b)); };
    $$(l, '[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; $$(l, '[data-k]').forEach(x => x.classList.toggle('on', x === b)); $(l, '#rng').classList.toggle('hide', kind !== 'range'); });
    drawList();
    $(l, '#mk').onclick = async () => {
      if (!navigator.onLine) return errBox($(l, '#err'), t('needOnline'));
      if (S.outbox.length) await flush();
      const btn = $(l, '#mk'); btn.disabled = true;
      try {
        const r = await api('POST', `/api/farmers/${fid}/statements`, { id: uuid(), kind, from: kind === 'range' ? $(l, '#sf').value : undefined, to: kind === 'range' ? $(l, '#stt').value : undefined });
        s.statements.unshift(r.statement); if (S.snap) { S.snap.statements.unshift(r.statement); LS.set(k('snap'), S.snap); } drawList();
        await downloadStatement(r.statement.id, f.name);
      } catch (e) { errBox($(l, '#err'), e.network ? t('needOnline') : errText(e)); }
      btn.disabled = false;
    };
    $(l, '#wshare').onclick = () => shareFarmerBill(fid);
  });
}
function shareFarmerBill(fid) {
  const s = overlay(), f = s.farmers.find(x => x.id === fid);
  if (!f) return toast(t('needOnline'));
  const mobile = (f.mobile || '').replace(/\D/g, '');
  if (!mobile) return toast('Mobile number missing');
  const received = s.payments.filter(p => p.farmer_id === fid && p.status !== 'voided').reduce((a, p) => a + p.amount_paise, 0);
  const recent = s.jobs.filter(j => j.farmer_id === fid && ['booked', 'running', 'completed', 'confirmed'].includes(j.status)).slice(-3).map(j => `${fmtDate(j.scheduled_date || j.start_at || todayIST())} · ${esc(j.implement_name || '')} · ${money(j.charge_paise || 0)}`);
  const msg = [
    `*${s.business.name || 'Hisab'}*`,
    `${f.name} (${f.village || ''})`,
    '',
    `कुल बिल: ${money(f.outstandingPaise + received + f.creditPaise)}`,
    `जमा: ${money(received)}`,
    `बाकी: ${money(Math.max(0, f.outstandingPaise))}`,
    '',
    'तपशील:',
    ...recent,
    '',
    'कृपया हिशोब तपासा.'
  ].join('\n');
  const url = `https://wa.me/91${mobile}?text=${encodeURIComponent(msg)}`;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) window.location.href = url;
}
async function downloadStatement(id, name, btn) {
  try {
    if (btn) btn.disabled = true;
    const reprint = LS.get('th:dl:' + id) ? '1' : '0';
    const blob = await api('GET', `/api/statements/${id}/pdf?reprint=${reprint}&lang=${lang === 'hi' ? 'hi' : 'mr'}`);
    LS.set('th:dl:' + id, 1);
    const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `hisab-${name}-${todayIST()}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
  } catch (e) { toast(e.network ? t('needOnline') : errText(e)); }
  if (btn) btn.disabled = false;
}
function opLabel(o, s) {
  const b = o.body || {}, f = s && s.farmers.find(x => x.id === (b.farmerId || (o.ref && o.ref.farmerId)));
  const who = f ? ' · ' + f.name : '';
  return ({ 'farmer.create': t('addFarmer') + ' · ' + (b.name || ''), 'farmer.update': t('editFarmer'), 'farm.create': t('addFarm') + ' · ' + (b.name || ''), 'job.create': t('newWork') + who, 'job.start': t('startNow') + who, 'job.complete': t('finishWork') + who,
    'job.delete': t('deleteEntry') + who,'job.update': t('edit') + who, 'job.confirm': t('confirmed') + ' ' + money(b.expectedChargePaise) + who, 'job.cancel': t('cancelJob') + who, 'job.correct': t('correct') + who, 'payment.create': t('payment') + ' ' + money(b.amountPaise) + who, 'payment.void': t('voidPay') + who,
    'tractor.create': t('addTractor'), 'implement.create': t('addImpl') + ' · ' + (b.name || ''), 'implement.update': t('implements'), 'business.update': t('business') }[o.kind] || o.kind);
}
function openOutbox() {
  const s = overlay();
  const draw = l => {
    $(l, '.body').innerHTML = `<p class="help">${t('outboxHelp')}</p>` + (S.outbox.length ? `<div class="card" style="padding:0 14px">${S.outbox.map((o, i) => `<div class="op"><span class="st ${o.status === 'sending' ? 'saving' : o.status}"><i></i></span><div class="row-m"><span class="row-t">${esc(opLabel(o, s))}</span><span class="row-s">${t({ pending: 'opPending', sending: 'opSending', failed: 'opFailed', conflict: 'opConflict' }[o.status])}${o.error ? ' — ' + esc(errText(o.error)) : ''}</span>
      ${o.status === 'failed' || o.status === 'conflict' ? `<div class="acts">${o.error && o.error.code === 'PREVIEW_STALE' ? `<button class="btn pri sm" data-use="${i}">${t('confirmCharge', { a: money(o.error.details.preview.chargePaise) })}</button>` : ''}${o.error && o.error.code === 'CONFLICT' && o.body && o.body.version != null ? `<button class="btn pri sm" data-rebase="${i}">${t('retry')}</button>` : ''}<button class="btn sec sm" data-retry="${i}">${t('retry')}</button><button class="btn danger sm" data-discard="${i}">${t('discard')}</button></div>` : ''}</div></div>`).join('')}</div>` : `<div class="card empty"><p>✓ ${t('outboxEmpty')}</p></div>`);
    const fix = (i, fn) => { const o = S.outbox[i]; fn(o); o.status = 'pending'; o.error = null; o.key = uuid(); saveOutbox(); flush(); draw(l); };
    $$(l, '[data-retry]').forEach(b => b.onclick = () => { const o = S.outbox[b.dataset.retry]; o.status = 'pending'; saveOutbox(); flush(); draw(l); });
    $$(l, '[data-discard]').forEach(b => b.onclick = () => { S.outbox.splice(Number(b.dataset.discard), 1); saveOutbox(); flush(); render(); draw(l); });
    $$(l, '[data-use]').forEach(b => b.onclick = () => fix(b.dataset.use, o => { o.body.expectedChargePaise = o.error.details.preview.chargePaise; }));
    $$(l, '[data-rebase]').forEach(b => b.onclick = () => fix(b.dataset.rebase, o => { o.body.version = o.error.details.current.version; }));
  };
  sheet(t('outbox'), '', '', l => draw(l));
}
function openQuick() {
  sheet(t('add'), `<div class="list"><button class="row" id="qw"><span class="pic lg">${P.tractor}</span><span class="row-m"><span class="row-t">${t('newWork')}</span></span>${I.chev}</button><button class="row" id="qp"><span class="pic lg">${P.cash}</span><span class="row-m"><span class="row-t">${t('receivePay')}</span></span>${I.chev}</button><button class="row" id="qf"><span class="pic lg">${P.farmer}</span><span class="row-m"><span class="row-t">${t('addFarmer')}</span></span>${I.chev}</button></div>`, '', (l, close) => {
    const fid = V().name === 'farmer' ? V().id : '';
    $(l, '#qw').onclick = () => { close(); openWork({ farmer: fid }); }; $(l, '#qp').onclick = () => { close(); openPay({ farmer: fid }); }; $(l, '#qf').onclick = () => { close(); openFarmer(); };
  });
}
function openImpl(id) {
  const s = overlay(), x = id ? s.implements.find(i => i.id === id) : null;
  sheet(x ? x.name : t('addImpl'), `<label class="field"><span>${t('name')}</span><input class="in" id="in" value="${esc(x ? x.name : '')}"></label><div class="grid2"><label class="field"><span>${t('rateType')}</span><select class="in" id="rt">${B.RATE_TYPES.map(r => `<option value="${r}" ${x && x.rate_type === r ? 'selected' : ''}>${rateL(r)}</option>`).join('')}</select></label><label class="field"><span>${t('rate')} (₹)</span><input class="in num" id="rp" inputmode="decimal" value="${x ? (x.rate_paise / 100).toFixed(2) : ''}"></label></div>${x ? `<div class="note warn">${t('rateChangeWarn')}</div>` : ''}<div id="err"></div>`,
   `<button class="btn sec" data-close>${t('cancel')}</button><button class="btn pri" id="save">${t('save')}</button>`, (l, close) => {
    $(l, '#save').onclick = () => { const n = $(l, '#in').value.trim(), rp = B.rupeesToPaise($(l, '#rp').value); if (!n || !rp) return errBox($(l, '#err'), te('RATE_INVALID'));
      if (x) enqueue('implement.update', 'PUT', `/api/implements/${x.id}`, { version: x.version, name: n, rateType: $(l, '#rt').value, ratePaise: rp }, { id: x.id }); else enqueue('implement.create', 'POST', '/api/implements', { id: uuid(), name: n, rateType: $(l, '#rt').value, ratePaise: rp }); close(); };
  });
}
async function logout() {
  const n = S.outbox.length;
  sheet(t('logout'), `<p>${n ? `<span class="c-due"><b>${t('logoutPending', { n })}</b></span>` : t('logoutQ')}</p>`, `<button class="btn sec" data-close>${t('cancel')}</button><button class="btn danger" id="ok">${t('logout')}</button>`, (l, close) => {
    $(l, '#ok').onclick = async () => {
      try { await api('POST', '/api/auth/logout', {}); } catch (_) {}
      Object.keys(localStorage).filter(x => x.startsWith('th:') && x !== 'th:lang').forEach(x => localStorage.removeItem(x)); // clear private cache
      Object.assign(S, { biz: null, snap: null, outbox: [], ledgers: {}, view: { name: 'home' }, sessionExpired: false }); close(); render();
    };
  });
}
const ACT = {
  quick: openQuick, work: d => openWork(d), pay: d => openPay(d), finish: d => openFinish(d.id), job: d => openJob(d.id), payment: d => openPayment(d.id), addFarmer: () => openFarmer(), editFarmer: d => openFarmer(d.id),
  addFarm: d => reasonSheet(t('addFarm'), t('farmName'), n => enqueue('farm.create', 'POST', `/api/farmers/${d.id}/farms`, { id: uuid(), name: n }, { farmerId: d.id }), 1),
  statements: d => openStatements(d.id), shareBill: d => shareFarmerBill(d.id), outbox: openOutbox, logout, relogin: () => { S.biz = null; authMode = 'login'; render(); },
  addTractor: () => reasonSheet(t('addTractor'), t('tractor'), n => enqueue('tractor.create', 'POST', '/api/tractors', { id: uuid(), name: n }), 1), addImpl: () => openImpl(), editImpl: d => openImpl(d.id),
  bizEdit: () => { const b = overlay().business; sheet(t('business'), `<label class="field"><span>${t('businessName')}</span><input class="in" id="bn" value="${esc(b.name)}"></label><label class="field"><span>${t('ownerName')}</span><input class="in" id="bo" value="${esc(b.owner_name)}"></label><label class="field"><span>${t('village')}</span><input class="in" id="bv" value="${esc(b.village || '')}"></label><label class="field"><span>${t('upiId')}</span><input class="in" id="bu" value="${esc(b.upi || '')}"></label>`, `<button class="btn pri block" id="ok" style="margin:0">${t('save')}</button>`, (l, close) => { $(l, '#ok').onclick = () => { enqueue('business.update', 'PUT', '/api/business', { name: $(l, '#bn').value, ownerName: $(l, '#bo').value, village: $(l, '#bv').value, upi: $(l, '#bu').value, lang }); close(); }; }); },
  questions: async () => { const close = sheet(t('questions'), '<div class="spin"></div>', ''); try { const q = await api('GET', '/api/questions'); const b = document.querySelector('.sheet .body'); if (b) b.innerHTML = q.length ? `<div class="list">${q.map(x => `<div class="row static"><span class="mi">${I.chat}</span><span class="row-m"><span class="row-t">${esc(x.farmer_name)}</span><span class="row-s" style="white-space:normal">${esc(x.message)}</span></span><small class="muted">${fmtDate(dIST(x.created_at))}</small></div>`).join('')}</div>` : `<div class="empty"><p>${t('noQuestions')}</p></div>`; } catch (e) { close(); toast(e.network ? t('needOnline') : errText(e)); } },
  export: async () => { try { const d = await api('GET', '/api/export'); const u = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = `tractor-hisab-${todayIST()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch (e) { toast(e.network ? t('needOnline') : errText(e)); } }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-et]'); if (b) { eTab = b.dataset.et; render(); } const lb = e.target.closest('main [data-lang]'); if (lb && S.biz) { lang = lb.dataset.lang; LS.set('th:lang', lang); document.documentElement.lang = lang; enqueue('business.update', 'PUT', '/api/business', { lang }); } });

/* ================= FARMER PORTAL ================= */
const FS = { step: 'phone', mobile: '', devCode: null, list: [], sel: null, data: null, seq: 0, err: '' };
async function farmerBoot() {
  S.mode = 'farmer';
  try { const me = await api('GET', '/api/auth/me'); if (me.kind === 'farmer') { FS.mobile = me.mobile; await loadBusinesses(me.selectedFarmerId); return; } } catch (_) {}
  FS.step = 'phone'; render();
}
async function loadBusinesses(pre) {
  FS.list = await api('GET', '/api/farmer/businesses');
  if (FS.list.length === 1) return selectBiz(FS.list[0].farmer_id);
  if (pre && FS.list.some(x => x.farmer_id === pre)) return selectBiz(pre);
  FS.step = 'choose'; render();
}
async function selectBiz(id) {
  const my = ++FS.seq; FS.sel = id; FS.data = null; FS.step = 'summary'; render();
  try {
    await api('POST', '/api/farmer/select', { farmerId: id });
    const d = await api('GET', '/api/farmer/summary');
    if (my !== FS.seq || d.farmerId !== FS.sel) return; // user switched business meanwhile — ignore the older response
    FS.data = d; render();
  } catch (e) { if (my === FS.seq) { FS.err = errText(e); render(); } }
}
function renderFarmer(app) {
  const top = (title, actions) => `<header class="bar"><div class="bar-in"><span class="logo"><img src="/icons/logo.svg" alt="" width="38" height="38"></span><div class="bar-t"><h1>${esc(title)}</h1><small>${t('app')}</small></div>${actions || ''}</div></header>`;
  if (FS.step === 'phone' || FS.step === 'otp') {
    app.innerHTML = `<main class="auth"><img class="logo" src="/icons/logo.svg" alt=""><h1>${t('farmerLogin')}</h1><p class="sub">${t('readOnly')}</p>${langSeg()}
    <form class="card form" id="ff" novalidate>${FS.step === 'phone' ? `<label class="field"><span>${t('mobile')}</span><div class="pre"><span>+91</span><input class="in num" id="fm" inputmode="numeric" maxlength="10" autocomplete="tel-national" value="${esc(FS.mobile)}"></div></label><div id="err" role="alert">${FS.err ? `<div class="note err">${esc(FS.err)}</div>` : ''}</div><button class="btn pri block">${t('sendOtp')}</button>`
     : `<p class="center">${t('otpSent')}<br><b class="num">+91 ${esc(FS.mobile)}</b></p>${FS.devCode ? `<div class="sms">${esc(t('devOtp', { c: FS.devCode }))}</div>` : ''}<label class="field"><span>${t('otp')}</span><input class="in num big" id="oc" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><div id="err" role="alert">${FS.err ? `<div class="note err">${esc(FS.err)}</div>` : ''}</div><button class="btn pri block">${t('verify')}</button><button class="btn ghost block" type="button" id="bk">${t('back')}</button>`}</form>
    <a class="btn ghost block" href="/" style="margin-top:12px">${t('ownerLink')}</a></main>`;
    $$(app, '[data-lang]').forEach(b => b.onclick = () => { lang = b.dataset.lang; LS.set('th:lang', lang); render(); });
    const bk = $(app, '#bk'); if (bk) bk.onclick = () => { FS.step = 'phone'; FS.err = ''; render(); };
    $(app, '#ff').onsubmit = async e => {
      e.preventDefault(); FS.err = '';
      try {
        if (FS.step === 'phone') { FS.mobile = $(app, '#fm').value.replace(/\D/g, ''); const r = await api('POST', '/api/farmer/otp/request', { mobile: FS.mobile }); FS.devCode = r.devCode || null; FS.step = 'otp'; render(); }
        else { await api('POST', '/api/farmer/otp/verify', { mobile: FS.mobile, code: $(app, '#oc').value.trim() }); FS.devCode = null; await loadBusinesses(); }
      } catch (er) { FS.err = er.network ? te('NETWORK') : errText(er); render(); }
    };
    return;
  }
  const logoutBtn = `<button class="btn ghost sm" id="flo">${t('logout')}</button>`;
  if (FS.step === 'choose') {
    app.innerHTML = top(t('chooseBusiness'), logoutBtn) + `<main class="wrap"><div class="list">${FS.list.map(x => `<button class="row" data-sel="${x.farmer_id}"><span class="pic">${P.tractor}</span><span class="row-m"><span class="row-t">${esc(x.business_name)}</span><span class="row-s">${esc([x.owner_name, x.village].filter(Boolean).join(' · '))}</span></span>${I.chev}</button>`).join('') || `<div class="empty"><p>${t('none')}</p></div>`}</div></main>`;
  } else {
    const d = FS.data, cur = FS.list.find(x => x.farmer_id === FS.sel);
    const paid = d ? d.rows.reduce((sum, r) => sum + (r.credit || 0), 0) : 0;
    const rem = d ? Math.max(0, d.outstandingPaise) : 0;
    app.innerHTML = top(cur ? cur.business_name : t('app'), (FS.list.length > 1 ? `<button class="btn ghost sm" id="sw">${t('change')}</button>` : '') + logoutBtn) + `<main class="wrap">${FS.err ? `<div class="banner err">${esc(FS.err)}</div>` : ''}
     ${!d ? '<div class="spin"></div>' : `<section class="hero"><div class="hero-g3"><div><div class="hero-l">${t('outstanding')}</div><div class="hero-a num">${money(d.outstandingPaise)}</div></div><div><div class="hero-l">${t('payment')}</div><div class="hero-a num" style="font-size:28px">${money(paid)}</div></div><div><div class="hero-l">${t('credit')}</div><div class="hero-a num" style="font-size:28px">${money(d.creditPaise)}</div></div></div><div class="hero-s" style="margin-top:6px">${esc(d.farmer.name)} · ${t('readOnly')}</div></section>
      ${d.outstandingPaise && d.business.upi ? `<div class="card upi"><span class="pic">${P.cash}</span><div><small>UPI</small><b>${esc(d.business.upi)}</b><small>${esc(d.business.owner_name)}</small></div></div>` : ''}
      <button class="btn sec block" id="fpdf" style="margin-top:12px">${I.pdf}${t('download')}</button>
      <button class="btn ghost block" id="fwa" style="margin-top:8px">WhatsApp</button>
      <h2 class="sec">${t('ledger')}</h2>${d.rows.length ? `<div class="list">${[...d.rows].reverse().map(r => `<div class="row static"><span class="pic">${r.kind === 'payment' ? P.cash : P.tractor}</span><span class="row-m"><span class="row-t">${esc(r.detail)}</span><span class="row-s">${esc(fmtDate(r.date) + (r.sub ? ' · ' + r.sub : ''))}</span></span><span class="row-e"><b class="num ${r.credit ? 'c-ok' : ''}">${r.credit ? '−' + money(r.credit) : money(r.debit)}</b><small class="num">${money(r.balance)}</small></span></div>`).join('')}</div>` : `<div class="card empty"><p>${t('none')}</p></div>`}
      <h2 class="sec">${t('ask')}</h2><div class="card form"><textarea class="in" id="q" rows="3" maxlength="1000" placeholder="${t('askPh')}" aria-label="${t('ask')}"></textarea><button class="btn pri block" id="qs">${t('send')}</button></div>`}</main>`;
  }
  $$(app, '[data-sel]').forEach(b => b.onclick = () => selectBiz(b.dataset.sel));
  const sw = $(app, '#sw'); if (sw) sw.onclick = () => { FS.step = 'choose'; FS.seq++; render(); };
  $(app, '#flo').onclick = async () => { try { await api('POST', '/api/auth/logout', {}); } catch (_) {} Object.assign(FS, { step: 'phone', list: [], sel: null, data: null, err: '' }); render(); };
  const fp = $(app, '#fpdf'); if (fp) fp.onclick = async () => { try { const b = await api('GET', `/api/farmer/statement.pdf?lang=${lang === 'hi' ? 'hi' : 'mr'}`); const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `hisab-${todayIST()}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch (e) { toast(errText(e)); } };
  const fwa = $(app, '#fwa'); if (fwa && FS.data) fwa.onclick = () => {
    const d = FS.data;
    const paid = d.rows.reduce((sum, r) => sum + (r.credit || 0), 0);
    const remaining = Math.max(0, d.outstandingPaise);
    const text = [
      `*${d.business.name}*`,
      `${d.farmer.name} (${d.farmer.village || ''})`,
      '',
      `कुल बिल: ${money(d.outstandingPaise + paid + d.creditPaise)}`,
      `जमा: ${money(paid)}`,
      `बाकी: ${money(remaining)}`,
      '',
      'तपशील:',
      ...d.rows.slice(-5).reverse().map(r => `${fmtDate(r.date)} — ${r.detail} — ${r.credit ? 'जमा ' + money(r.credit) : money(r.debit)}`),
      '',
      'बिल PDF डाउनलोड करण्यासाठी app वरून PDF बटण वापरा.'
    ].join('\n');
    const mobile = (d.farmer.mobile || FS.mobile || '').replace(/\D/g, '');
    const target = mobile ? `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(target, '_blank', 'noopener');
  };
  const qs = $(app, '#qs'); if (qs) qs.onclick = async () => { const m = $(app, '#q').value.trim(); if (!m) return; qs.disabled = true; try { await api('POST', '/api/farmer/questions', { message: m }); $(app, '#q').value = ''; toast(t('sent')); } catch (e) { toast(errText(e)); } qs.disabled = false; };
}

/* ================= START ================= */
document.documentElement.lang = lang;
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
if (location.pathname.startsWith('/farmer')) farmerBoot(); else boot();
window.__th = { S, flush, overlay }; // test hook (read-only use)
