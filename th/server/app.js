const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { types } = require('pg');
const { tx } = require('./db');
const B = require('./billing');
const otp = require('./otp');
const pdf = require('./pdf');

types.setTypeParser(20, v => parseInt(v, 10));    // int8 -> number (paise fit in 2^53)
types.setTypeParser(1700, v => parseFloat(v));     // numeric (meter readings)
types.setTypeParser(1082, v => v);                 // date stays 'YYYY-MM-DD'

class HttpError extends Error { constructor(status, code, details) { super(code); this.status = status; this.code = code; this.details = details; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOBILE = /^[6-9][0-9]{9}$/;
const istDate = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const todayIST = () => istDate(Date.now());
const nowMinute = () => { const d = new Date(); d.setSeconds(0, 0); return d.toISOString(); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function str(v, name, min, max, optional) {
  if (v == null || v === '') { if (optional) return null; throw new HttpError(400, 'REQUIRED', { field: name }); }
  if (typeof v !== 'string') throw new HttpError(400, 'INVALID', { field: name });
  const s = v.trim(); if (s.length < min || s.length > max) throw new HttpError(400, 'LENGTH', { field: name, min, max });
  return s;
}
function mobile(v, optional) { if ((v == null || v === '') && optional) return null; const m = String(v || '').replace(/\D/g, '').slice(-10); if (!MOBILE.test(m)) throw new HttpError(400, 'MOBILE_INVALID', { field: 'mobile' }); return m; }
function date(v, name, optional) {
  if ((v == null || v === '') && optional) return null;
  if (!B.istToISO(v, '00:00')) throw new HttpError(400, 'DATE_INVALID', { field: name });
  if (v > todayIST()) throw new HttpError(400, 'DATE_FUTURE', { field: name });
  return v;
}
function uuid(v, name, optional) { if ((v == null || v === '') && optional) return null; if (!UUID.test(String(v))) throw new HttpError(400, 'ID_INVALID', { field: name }); return v; }
function ts(v, name, optional) {
  if ((v == null || v === '') && optional) return null;
  const d = new Date(v); if (typeof v !== 'string' || isNaN(d)) throw new HttpError(400, 'TIME_INVALID', { field: name });
  if (d.getTime() > Date.now() + 5 * 60000) throw new HttpError(400, 'TIME_FUTURE', { field: name });
  return d.toISOString();
}
function int(v, name, min, max) { if (!Number.isSafeInteger(v) || v < min || v > max) throw new HttpError(400, 'INVALID', { field: name }); return v; }

function hashPassword(pw) { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }); return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`; }
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$'); if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function parseCookies(h) { const o = {}; (h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }

function createApp({ pool, env = process.env }) {
  const app = express();
  const prod = env.NODE_ENV === 'production';
  const COOKIE = prod ? '__Host-th_sid' : 'th_sid';
  const otpProvider = otp.assertConfig(env);
  if (prod && !env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  const SECRET = env.SESSION_SECRET || 'dev-only-secret';
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (prod) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.json({ limit: '200kb' }));

  // ---- rate limiting (stored in Postgres so it survives restarts) ----
  async function limit(key, max, windowSec) {
    await pool.query("delete from rate_limits where at < now() - interval '1 day'");
    const r = await pool.query('select count(*)::int n from rate_limits where key=$1 and at > now() - make_interval(secs => $2)', [key, windowSec]);
    if (r.rows[0].n >= max) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    await pool.query('insert into rate_limits(key) values ($1)', [key]);
  }

  // ---- sessions ----
  async function newSession(res, row, days) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query('insert into sessions(id,kind,owner_user_id,business_id,farmer_mobile,expires_at) values ($1,$2,$3,$4,$5, now() + make_interval(days => $6))',
      [sha(token + SECRET), row.kind, row.owner_user_id || null, row.business_id || null, row.farmer_mobile || null, days]);
    res.cookie(COOKIE, token, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: days * 864e5 });
  }
  app.use(async (req, res, next) => {
    try {
      const tok = parseCookies(req.headers.cookie)[COOKIE];
      if (tok) {
        const r = await pool.query('select * from sessions where id=$1 and expires_at > now()', [sha(tok + SECRET)]);
        req.session = r.rows[0] || null; req.sessionToken = tok;
      }
      next();
    } catch (e) { next(e); }
  });
  // CSRF: state-changing requests must carry our custom header (forces CORS preflight, which we never allow) and same-origin Origin.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.get('X-Requested-With') !== 'tractor-hisab') return next(new HttpError(403, 'CSRF'));
    const o = req.get('Origin'); if (o && new URL(o).host !== req.get('host')) return next(new HttpError(403, 'CSRF'));
    next();
  });
  const owner = (req, res, next) => { if (!req.session || req.session.kind !== 'owner') return next(new HttpError(401, 'LOGIN_REQUIRED')); req.biz = req.session.business_id; req.actor = 'owner:' + req.session.owner_user_id; next(); };
  const farmerAuth = (req, res, next) => { if (!req.session || req.session.kind !== 'farmer') return next(new HttpError(401, 'LOGIN_REQUIRED')); next(); };
  const h = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  // Idempotent mutation: one transaction; a replayed Idempotency-Key returns the stored response without re-applying.
  const mut = fn => h(async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || !UUID.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY');
    const out = await tx(pool, async c => {
      const ins = await c.query('insert into applied_ops(op_id,business_id) values ($1,$2) on conflict do nothing returning op_id', [key, req.biz]);
      if (!ins.rowCount) {
        const r = (await c.query('select business_id,status,response from applied_ops where op_id=$1', [key])).rows[0];
        if (r.business_id !== req.biz) throw new HttpError(409, 'KEY_REUSED');
        return { status: r.status, body: r.response, replay: true };
      }
      const result = await fn(req, c);
      await c.query('update applied_ops set status=$2, response=$3 where op_id=$1', [key, result.status || 200, JSON.stringify(result.body)]);
      return result;
    });
    if (out.replay) res.set('Idempotent-Replay', 'true');
    res.status(out.status || 200).json(out.body);
  });

  const audit = (c, req, action, entity, id, before, after, reason) =>
    c.query('insert into audit_log(business_id,actor,action,entity,entity_id,before,after,reason) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.biz, req.actor, action, entity, id, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason || null]);
  async function one(c, sql, args, code = 'NOT_FOUND') { const r = await c.query(sql, args); if (!r.rowCount) throw new HttpError(404, code); return r.rows[0]; }
  const farmerOf = (c, biz, id, lock) => one(c, `select * from farmers where id=$1 and business_id=$2${lock ? ' for update' : ''}`, [uuid(id, 'farmerId'), biz], 'FARMER_NOT_FOUND');
  const jobOf = (c, biz, id) => one(c, 'select * from jobs where id=$1 and business_id=$2 for update', [uuid(id, 'jobId'), biz], 'JOB_NOT_FOUND');
  function checkVersion(row, v) { if (v == null) throw new HttpError(400, 'VERSION_REQUIRED'); if (row.version !== v) throw new HttpError(409, 'CONFLICT', { current: row }); }
  const ledgerAdd = (c, e) => c.query('insert into ledger_entries(business_id,farmer_id,kind,amount_paise,job_id,payment_id,reverses_id,entry_date,memo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
    [e.biz, e.farmer, e.kind, e.amount, e.job || null, e.payment || null, e.reverses || null, e.date, e.memo || null]).then(r => r.rows[0]);

  // ================= AUTH =================
  app.post('/api/auth/register', h(async (req, res) => {
    await limit('reg:' + req.ip, Number(env.REGISTER_LIMIT_PER_HOUR || 5), 3600);
    if (env.OWNER_SETUP_CODE && req.body.setupCode !== env.OWNER_SETUP_CODE) throw new HttpError(403, 'SETUP_CODE');
    const b = { businessName: str(req.body.businessName, 'businessName', 1, 120), ownerName: str(req.body.ownerName, 'ownerName', 1, 120), village: str(req.body.village, 'village', 1, 80, true), mobile: mobile(req.body.mobile) };
    const pw = req.body.password; if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) throw new HttpError(400, 'PASSWORD_WEAK');
    const u = await tx(pool, async c => {
      const exists = await c.query('select 1 from owner_users where mobile=$1', [b.mobile]); if (exists.rowCount) throw new HttpError(409, 'MOBILE_TAKEN');
      const biz = (await c.query('insert into businesses(name,owner_name,village,is_demo) values ($1,$2,$3,$4) returning *', [b.businessName, b.ownerName, b.village, req.body.demo === true && !prod])).rows[0];
      const user = (await c.query('insert into owner_users(business_id,mobile,name,password_hash) values ($1,$2,$3,$4) returning id,business_id', [biz.id, b.mobile, b.ownerName, hashPassword(pw)])).rows[0];
      return user;
    });
    await newSession(res, { kind: 'owner', owner_user_id: u.id, business_id: u.business_id }, 30);
    res.status(201).json({ ok: true });
  }));
  app.post('/api/auth/login', h(async (req, res) => {
    const m = mobile(req.body.mobile); await limit('login:' + m, 8, 900);
    const r = await pool.query('select * from owner_users where mobile=$1', [m]);
    const ok = r.rowCount && typeof req.body.password === 'string' && verifyPassword(req.body.password, r.rows[0].password_hash);
    if (!ok) throw new HttpError(401, 'LOGIN_FAILED');
    await newSession(res, { kind: 'owner', owner_user_id: r.rows[0].id, business_id: r.rows[0].business_id }, 30);
    res.json({ ok: true });
  }));
  app.post('/api/auth/logout', h(async (req, res) => {
    if (req.sessionToken) await pool.query('delete from sessions where id=$1', [sha(req.sessionToken + SECRET)]);
    res.clearCookie(COOKIE, { path: '/', secure: prod, httpOnly: true, sameSite: 'lax' }); res.json({ ok: true });
  }));
  app.get('/api/auth/me', h(async (req, res) => {
    if (!req.session) return res.json({ kind: null });
    if (req.session.kind === 'farmer') return res.json({ kind: 'farmer', mobile: req.session.farmer_mobile, selectedFarmerId: req.session.selected_farmer_id });
    const r = await pool.query('select u.name, u.mobile, b.* from owner_users u join businesses b on b.id=u.business_id where u.id=$1', [req.session.owner_user_id]);
    res.json({ kind: 'owner', user: { name: r.rows[0].name, mobile: r.rows[0].mobile }, business: r.rows[0] });
  }));

  // ================= OWNER DATA =================
  async function balances(c, biz) {
    const r = await c.query('select farmer_id, sum(amount_paise)::bigint bal from ledger_entries where business_id=$1 group by farmer_id', [biz]);
    return Object.fromEntries(r.rows.map(x => [x.farmer_id, x.bal]));
  }
  app.get('/api/snapshot', owner, h(async (req, res) => {
    const biz = req.biz, q = (s, a = [biz]) => pool.query(s, a).then(r => r.rows);
    const [business, tractors, implementsL, farmers, farms, jobs, payments, statements, bal] = await Promise.all([
      q('select * from businesses where id=$1').then(r => r[0]), q('select * from tractors where business_id=$1 order by created_at'),
      q('select * from implements where business_id=$1 order by created_at'), q('select * from farmers where business_id=$1 order by name'),
      q('select * from farms where business_id=$1 order by created_at'),
      q("select * from jobs where business_id=$1 and status <> 'superseded' and (status in ('booked','running','completed','confirmed') or coalesce(end_at,created_at) > now() - interval '400 days') order by coalesce(start_at,created_at) desc"),
      q("select * from payments where business_id=$1 and paid_on > (now() - interval '400 days')::date order by paid_on desc, created_at desc"),
      q('select id,farmer_id,kind,from_date,to_date,opening_paise,closing_paise,created_at from statements where business_id=$1 order by created_at desc'),
      balances(pool, biz)]);
    res.json({ business, tractors, implements: implementsL, farmers: farmers.map(f => ({ ...f, farms: farms.filter(x => x.farmer_id === f.id), ...B.summarize([{ amountPaise: bal[f.id] || 0 }]) })),
      jobs, payments, statements, serverTime: new Date().toISOString() });
  }));
  app.put('/api/business', owner, mut(async (req, c) => {
    const before = await one(c, 'select * from businesses where id=$1 for update', [req.biz]);
    const lang = ['mr', 'hi', 'en'].includes(req.body.lang) ? req.body.lang : before.lang;
    const after = (await c.query('update businesses set name=$2, owner_name=$3, village=$4, upi=$5, lang=$6 where id=$1 returning *',
      [req.biz, str(req.body.name ?? before.name, 'name', 1, 120), str(req.body.ownerName ?? before.owner_name, 'ownerName', 1, 120), str(req.body.village ?? before.village, 'village', 0, 80, true), str(req.body.upi ?? before.upi, 'upi', 3, 80, true), lang])).rows[0];
    await audit(c, req, 'update', 'business', req.biz, before, after);
    return { body: after };
  }));
  app.post('/api/tractors', owner, mut(async (req, c) => {
    const t = (await c.query('insert into tractors(id,business_id,name) values ($1,$2,$3) returning *', [uuid(req.body.id, 'id'), req.biz, str(req.body.name, 'name', 1, 80)])).rows[0];
    await audit(c, req, 'create', 'tractor', t.id, null, t); return { status: 201, body: t };
  }));
  app.put('/api/tractors/:id', owner, mut(async (req, c) => {
    const b = await one(c, 'select * from tractors where id=$1 and business_id=$2 for update', [uuid(req.params.id, 'id'), req.biz]); checkVersion(b, req.body.version);
    const a = (await c.query('update tractors set name=$2, active=$3, version=version+1 where id=$1 returning *', [b.id, str(req.body.name ?? b.name, 'name', 1, 80), req.body.active !== false])).rows[0];
    await audit(c, req, 'update', 'tractor', b.id, b, a); return { body: a };
  }));
  app.post('/api/implements', owner, mut(async (req, c) => {
    const rt = req.body.rateType; if (!B.RATE_TYPES.includes(rt)) throw new HttpError(400, 'RATE_TYPE');
    const i = (await c.query('insert into implements(id,business_id,name,rate_type,rate_paise) values ($1,$2,$3,$4,$5) returning *',
      [uuid(req.body.id, 'id'), req.biz, str(req.body.name, 'name', 1, 80), rt, int(req.body.ratePaise, 'ratePaise', 1, 10000000)])).rows[0];
    await audit(c, req, 'create', 'implement', i.id, null, i); return { status: 201, body: i };
  }));
  app.put('/api/implements/:id', owner, mut(async (req, c) => {
    const b = await one(c, 'select * from implements where id=$1 and business_id=$2 for update', [uuid(req.params.id, 'id'), req.biz]); checkVersion(b, req.body.version);
    const rt = req.body.rateType ?? b.rate_type; if (!B.RATE_TYPES.includes(rt)) throw new HttpError(400, 'RATE_TYPE');
    const a = (await c.query('update implements set name=$2, rate_type=$3, rate_paise=$4, active=$5, version=version+1 where id=$1 returning *',
      [b.id, str(req.body.name ?? b.name, 'name', 1, 80), rt, int(req.body.ratePaise ?? b.rate_paise, 'ratePaise', 1, 10000000), req.body.active !== false])).rows[0];
    await audit(c, req, b.rate_paise !== a.rate_paise ? 'rate_change' : 'update', 'implement', b.id, b, a, 'Applies to new work only; past jobs keep their applied rate');
    return { body: a };
  }));

  // ---- farmers & farms ----
  app.post('/api/farmers', owner, mut(async (req, c) => {
    const f = (await c.query('insert into farmers(id,business_id,name,village,mobile) values ($1,$2,$3,$4,$5) returning *',
      [uuid(req.body.id, 'id'), req.biz, str(req.body.name, 'name', 1, 120), str(req.body.village, 'village', 1, 80, true), mobile(req.body.mobile, true)])).rows[0];
    const farms = [];
    for (const fm of (Array.isArray(req.body.farms) ? req.body.farms : [])) {
      farms.push((await c.query('insert into farms(id,business_id,farmer_id,name) values ($1,$2,$3,$4) returning *', [uuid(fm.id, 'farmId'), req.biz, f.id, str(fm.name, 'farmName', 1, 80)])).rows[0]);
    }
    await audit(c, req, 'create', 'farmer', f.id, null, { ...f, farms }); return { status: 201, body: { ...f, farms } };
  }));
  app.put('/api/farmers/:id', owner, mut(async (req, c) => {
    const b = await farmerOf(c, req.biz, req.params.id, true); checkVersion(b, req.body.version);
    const a = (await c.query('update farmers set name=$2, village=$3, mobile=$4, version=version+1, updated_at=now() where id=$1 returning *',
      [b.id, str(req.body.name ?? b.name, 'name', 1, 120), str(req.body.village ?? b.village, 'village', 1, 80, true), mobile(req.body.mobile === undefined ? b.mobile : req.body.mobile, true)])).rows[0];
    await audit(c, req, 'update', 'farmer', b.id, b, a); return { body: a };
  }));
  app.post('/api/farmers/:id/farms', owner, mut(async (req, c) => {
    const f = await farmerOf(c, req.biz, req.params.id);
    const fm = (await c.query('insert into farms(id,business_id,farmer_id,name) values ($1,$2,$3,$4) returning *', [uuid(req.body.id, 'id'), req.biz, f.id, str(req.body.name, 'name', 1, 80)])).rows[0];
    await audit(c, req, 'create', 'farm', fm.id, null, fm); return { status: 201, body: fm };
  }));

  // ---- jobs ----
  function compute(j) {
    const r = B.computeCharge({ rateType: j.rate_type, ratePaise: j.applied_rate_paise, startAt: j.start_at, endAt: j.end_at, breakMinutes: j.break_minutes, qtyHundredths: j.qty_hundredths });
    const m = B.checkMeter({ meterStart: j.meter_start, meterEnd: j.meter_end, meterReset: j.meter_reset, meterNote: j.meter_note });
    return { ...r, ok: r.ok && m.ok, errors: [...r.errors, ...m.errors], meterHours: m.meterHours };
  }
  function applyFields(j, body) {
    const n = { ...j };
    if ('startAt' in body) n.start_at = ts(body.startAt, 'startAt', true);
    if ('endAt' in body) n.end_at = ts(body.endAt, 'endAt', true);
    if ('breakMinutes' in body) n.break_minutes = body.breakMinutes === '' || body.breakMinutes == null ? 0 : body.breakMinutes;
    if ('qty' in body) { n.qty_hundredths = body.qty === '' || body.qty == null ? null : B.qtyToHundredths(body.qty); if (body.qty && n.qty_hundredths == null) throw new HttpError(400, 'QTY_INVALID'); }
    for (const [k, col] of [['meterStart', 'meter_start'], ['meterEnd', 'meter_end']]) if (k in body) n[col] = body[k] === '' || body[k] == null ? null : body[k];
    if ('meterReset' in body) n.meter_reset = body.meterReset === true;
    if ('meterNote' in body) n.meter_note = str(body.meterNote, 'meterNote', 0, 200, true);
    if ('note' in body) n.note = str(body.note, 'note', 0, 500, true);
    if ('farmId' in body) n.farm_id = uuid(body.farmId, 'farmId', true);
    if ('scheduledDate' in body) n.scheduled_date = body.scheduledDate || null;
    const bm = n.break_minutes; if (!Number.isSafeInteger(bm) || bm < 0) throw new HttpError(400, 'BREAK_INVALID');
    return n;
  }
  async function resolveRate(c, req, impl, override) {
    if (!override) return { applied: impl.rate_paise, reason: null };
    if (override.confirmed !== true) throw new HttpError(400, 'OVERRIDE_CONFIRM');
    const reason = str(override.reason, 'overrideReason', 5, 200);
    const rate = int(override.ratePaise, 'overrideRate', 1, 10000000);
    return { applied: rate, reason: rate === impl.rate_paise ? null : reason };
  }
  async function saveJob(c, n, extraCols = {}) {
    const cols = ['farm_id', 'start_at', 'end_at', 'break_minutes', 'qty_hundredths', 'meter_start', 'meter_end', 'meter_reset', 'meter_note', 'note', 'scheduled_date', 'status', 'billable_minutes', 'charge_paise', ...Object.keys(extraCols)];
    const vals = cols.map(k => k in extraCols ? extraCols[k] : n[k]);
    return (await c.query(`update jobs set ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, version=version+1, updated_at=now() where id=$1 returning *`, [n.id, ...vals])).rows[0];
  }
  async function checkFarm(c, biz, farmerId, farmId) { if (farmId) await one(c, 'select 1 from farms where id=$1 and farmer_id=$2 and business_id=$3', [farmId, farmerId, biz], 'FARM_NOT_FOUND'); }
  const failIfErrors = r => { if (!r.ok) throw new HttpError(400, 'VALIDATION', { errors: r.errors }); };

  app.post('/api/jobs', owner, mut(async (req, c) => {
    const body = req.body, mode = body.mode;
    if (!['book', 'start', 'historical'].includes(mode)) throw new HttpError(400, 'MODE');
    const f = await farmerOf(c, req.biz, body.farmerId);
    const impl = await one(c, 'select * from implements where id=$1 and business_id=$2 and active', [uuid(body.implementId, 'implementId'), req.biz], 'IMPLEMENT_NOT_FOUND');
    const tractorId = uuid(body.tractorId, 'tractorId', true); if (tractorId) await one(c, 'select 1 from tractors where id=$1 and business_id=$2', [tractorId, req.biz], 'TRACTOR_NOT_FOUND');
    const rate = await resolveRate(c, req, impl, body.rateOverride);
    let n = applyFields({ id: uuid(body.id, 'id'), break_minutes: 0, meter_reset: false }, body);
    await checkFarm(c, req.biz, f.id, n.farm_id);
    let status;
    if (mode === 'book') { n.scheduled_date = str(body.scheduledDate, 'scheduledDate', 10, 10); if (!B.istToISO(n.scheduled_date, '00:00')) throw new HttpError(400, 'DATE_INVALID'); n.start_at = null; n.end_at = null; status = 'booked'; }
    if (mode === 'start') { n.start_at = ts(body.startAt || nowMinute(), 'startAt'); n.end_at = null; status = 'running'; }
    let preview = null;
    if (mode === 'historical') {
      if (impl.rate_type === 'hour' && (!n.start_at || !n.end_at)) throw new HttpError(400, 'VALIDATION', { errors: ['START_INVALID'] });
      preview = compute({ ...n, rate_type: impl.rate_type, applied_rate_paise: rate.applied }); failIfErrors(preview); status = 'completed';
    } else {
      const m = B.checkMeter({ meterStart: n.meter_start, meterEnd: null }); failIfErrors(m);
    }
    const j = (await c.query(`insert into jobs(id,business_id,farmer_id,farm_id,tractor_id,implement_id,implement_name,rate_type,standard_rate_paise,applied_rate_paise,rate_override_reason,status,scheduled_date,start_at,end_at,break_minutes,qty_hundredths,meter_start,meter_end,meter_reset,meter_note,billable_minutes,charge_paise,note)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) returning *`,
      [n.id, req.biz, f.id, n.farm_id || null, tractorId, impl.id, impl.name, impl.rate_type, impl.rate_paise, rate.applied, rate.reason, status, n.scheduled_date || null, n.start_at || null, n.end_at || null,
       n.break_minutes, n.qty_hundredths || null, n.meter_start ?? null, n.meter_end ?? null, n.meter_reset, n.meter_note || null, preview ? preview.billableMinutes : null, preview ? preview.chargePaise : null, n.note || null])).rows[0];
    await audit(c, req, 'create', 'job', j.id, null, j);
    if (rate.reason) await audit(c, req, 'rate_override', 'job', j.id, { ratePaise: impl.rate_paise }, { ratePaise: rate.applied }, rate.reason);
    return { status: 201, body: { job: j, preview } };
  }));
  app.post('/api/jobs/:id/start', owner, mut(async (req, c) => {
    const j = await jobOf(c, req.biz, req.params.id); checkVersion(j, req.body.version);
    if (j.status !== 'booked') throw new HttpError(409, 'BAD_STATE', { status: j.status });
    const n = applyFields(j, { meterStart: req.body.meterStart ?? j.meter_start }); n.start_at = ts(req.body.startAt || nowMinute(), 'startAt'); n.status = 'running';
    failIfErrors(B.checkMeter({ meterStart: n.meter_start }));
    const a = await saveJob(c, n); await audit(c, req, 'start', 'job', j.id, j, a); return { body: { job: a } };
  }));
  app.post('/api/jobs/:id/complete', owner, mut(async (req, c) => {
    const j = await jobOf(c, req.biz, req.params.id); checkVersion(j, req.body.version);
    if (j.status !== 'running') throw new HttpError(409, 'BAD_STATE', { status: j.status });
    const n = applyFields(j, { endAt: req.body.endAt || new Date().toISOString(), ...pick(req.body, ['breakMinutes', 'meterEnd', 'meterReset', 'meterNote', 'qty', 'note', 'farmId']) });
    await checkFarm(c, req.biz, j.farmer_id, n.farm_id);
    const p = compute(n); failIfErrors(p); n.status = 'completed'; n.billable_minutes = p.billableMinutes; n.charge_paise = p.chargePaise;
    const a = await saveJob(c, n); await audit(c, req, 'complete', 'job', j.id, j, a); return { body: { job: a, preview: p } };
  }));
  app.put('/api/jobs/:id', owner, mut(async (req, c) => {
    const j = await jobOf(c, req.biz, req.params.id); checkVersion(j, req.body.version);
    if (!['booked', 'running', 'completed'].includes(j.status)) throw new HttpError(409, 'BAD_STATE', { status: j.status });
    const n = applyFields(j, req.body); await checkFarm(c, req.biz, j.farmer_id, n.farm_id);
    let p = null;
    if (j.status === 'completed') { p = compute(n); failIfErrors(p); n.billable_minutes = p.billableMinutes; n.charge_paise = p.chargePaise; }
    const a = await saveJob(c, n); await audit(c, req, 'edit', 'job', j.id, j, a); return { body: { job: a, preview: p } };
  }));
  app.get('/api/jobs/:id/preview', owner, h(async (req, res) => {
    const j = await one(pool, 'select * from jobs where id=$1 and business_id=$2', [uuid(req.params.id, 'id'), req.biz], 'JOB_NOT_FOUND');
    res.json({ job: j, preview: compute(j) });
  }));
  app.post('/api/jobs/:id/confirm', owner, mut(async (req, c) => {
    const j = await jobOf(c, req.biz, req.params.id);
    if (j.status === 'confirmed') throw new HttpError(409, 'ALREADY_CONFIRMED');
    if (j.status !== 'completed') throw new HttpError(409, 'BAD_STATE', { status: j.status });
    const p = compute(j); failIfErrors(p);
    if (req.body.expectedChargePaise !== p.chargePaise) throw new HttpError(409, 'PREVIEW_STALE', { preview: p });
    const a = (await c.query("update jobs set status='confirmed', billable_minutes=$2, charge_paise=$3, confirmed_at=now(), version=version+1, updated_at=now() where id=$1 returning *", [j.id, p.billableMinutes, p.chargePaise])).rows[0];
    const entry = await ledgerAdd(c, { biz: req.biz, farmer: j.farmer_id, kind: 'charge', amount: p.chargePaise, job: j.id, date: istDate(j.end_at || j.scheduled_date || Date.now()), memo: j.implement_name });
    await audit(c, req, 'confirm_charge', 'job', j.id, j, a);
    return { body: { job: a, entry } };
  }));
  app.post('/api/jobs/:id/cancel', owner, mut(async (req, c) => {
    const j = await jobOf(c, req.biz, req.params.id);
    if (!['booked', 'running', 'completed'].includes(j.status)) throw new HttpError(409, 'BAD_STATE', { status: j.status });
    const reason = str(req.body.reason, 'reason', 3, 200);
    const a = (await c.query("update jobs set status='cancelled', cancel_reason=$2, version=version+1, updated_at=now() where id=$1 returning *", [j.id, reason])).rows[0];
    await audit(c, req, 'cancel', 'job', j.id, j, a, reason); return { body: { job: a } };
  }));
  // Correct a confirmed charge: original job + ledger entry are preserved; a reversal and a new confirmed job are added.
  app.post('/api/jobs/:id/correct', owner, mut(async (req, c) => {
    const j = await jobOf(c, req.biz, req.params.id);
    if (j.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', { status: j.status });
    const reason = str(req.body.reason, 'reason', 5, 200);
    const n = applyFields({ ...j }, req.body);
    if (req.body.ratePaise != null && req.body.ratePaise !== j.applied_rate_paise) { n.applied_rate_paise = int(req.body.ratePaise, 'ratePaise', 1, 10000000); n.rate_override_reason = reason; }
    const p = compute(n); failIfErrors(p);
    const newId = uuid(req.body.newId, 'newId');
    const orig = (await c.query("select * from ledger_entries where job_id=$1 and kind='charge'", [j.id])).rows[0];
    await c.query("update jobs set status='superseded', version=version+1, updated_at=now() where id=$1", [j.id]);
    await ledgerAdd(c, { biz: req.biz, farmer: j.farmer_id, kind: 'reversal', amount: -orig.amount_paise, reverses: orig.id, job: null, date: orig.entry_date, memo: 'दुरुस्ती: ' + reason });
    const nj = (await c.query(`insert into jobs(id,business_id,farmer_id,farm_id,tractor_id,implement_id,implement_name,rate_type,standard_rate_paise,applied_rate_paise,rate_override_reason,status,scheduled_date,start_at,end_at,break_minutes,qty_hundredths,meter_start,meter_end,meter_reset,meter_note,billable_minutes,charge_paise,note,corrected_from,confirmed_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now()) returning *`,
      [newId, req.biz, j.farmer_id, n.farm_id, j.tractor_id, j.implement_id, j.implement_name, j.rate_type, j.standard_rate_paise, n.applied_rate_paise, n.rate_override_reason, j.scheduled_date, n.start_at, n.end_at, n.break_minutes, n.qty_hundredths, n.meter_start, n.meter_end, n.meter_reset, n.meter_note, p.billableMinutes, p.chargePaise, n.note, j.id])).rows[0];
    const entry = await ledgerAdd(c, { biz: req.biz, farmer: j.farmer_id, kind: 'charge', amount: p.chargePaise, job: nj.id, date: istDate(nj.end_at || nj.scheduled_date || Date.now()), memo: nj.implement_name });
    await audit(c, req, 'correct_charge', 'job', j.id, j, nj, reason);
    return { status: 201, body: { job: nj, entry } };
  }));

  // ---- payments (independent of jobs: full, partial or advance) ----
  app.post('/api/payments', owner, mut(async (req, c) => {
    const f = await farmerOf(c, req.biz, req.body.farmerId);
    const mode = ['cash', 'upi', 'cheque', 'other'].includes(req.body.mode) ? req.body.mode : null; if (!mode) throw new HttpError(400, 'MODE');
    const p = (await c.query('insert into payments(id,business_id,farmer_id,amount_paise,mode,reference,paid_on,note) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [uuid(req.body.id, 'id'), req.biz, f.id, int(req.body.amountPaise, 'amountPaise', 1, 10000000000), mode, str(req.body.reference, 'reference', 0, 60, true), date(req.body.paidOn, 'paidOn'), str(req.body.note, 'note', 0, 300, true)])).rows[0];
    const entry = await ledgerAdd(c, { biz: req.biz, farmer: f.id, kind: 'payment', amount: -p.amount_paise, payment: p.id, date: p.paid_on, memo: mode });
    await audit(c, req, 'create', 'payment', p.id, null, p);
    return { status: 201, body: { payment: p, entry } };
  }));
  app.post('/api/payments/:id/void', owner, mut(async (req, c) => {
    const p = await one(c, 'select * from payments where id=$1 and business_id=$2 for update', [uuid(req.params.id, 'id'), req.biz], 'PAYMENT_NOT_FOUND');
    if (p.status !== 'active') throw new HttpError(409, 'ALREADY_VOIDED');
    const reason = str(req.body.reason, 'reason', 5, 200);
    const orig = (await c.query("select * from ledger_entries where payment_id=$1 and kind='payment'", [p.id])).rows[0];
    await ledgerAdd(c, { biz: req.biz, farmer: p.farmer_id, kind: 'reversal', amount: -orig.amount_paise, reverses: orig.id, date: orig.entry_date, memo: 'रद्द: ' + reason });
    const a = (await c.query("update payments set status='voided', void_reason=$2 where id=$1 returning *", [p.id, reason])).rows[0];
    await audit(c, req, 'void', 'payment', p.id, p, a, reason); return { body: { payment: a } };
  }));

  // ---- ledger & statements ----
  const MODE_MR = { cash: 'रोख', upi: 'UPI', cheque: 'चेक', other: 'इतर' };
  async function ledgerRows(c, biz, farmerId, from, to) {
    const r = await c.query(`select e.*, j.farm_id, j.start_at, j.end_at, j.billable_minutes, j.applied_rate_paise, j.rate_type, j.qty_hundredths, j.break_minutes, j.meter_start, j.meter_end, j.rate_override_reason, fm.name farm_name,
        p.mode, p.reference, rj.implement_name rev_impl, rp.mode rev_mode
      from ledger_entries e left join jobs j on j.id=e.job_id left join farms fm on fm.id=j.farm_id left join payments p on p.id=e.payment_id
      left join ledger_entries re on re.id=e.reverses_id left join jobs rj on rj.id=re.job_id left join payments rp on rp.id=re.payment_id
      where e.business_id=$1 and e.farmer_id=$2 and ($3::date is null or e.entry_date >= $3) and ($4::date is null or e.entry_date <= $4)
      order by e.entry_date, e.created_at, e.id`, [biz, farmerId, from, to]);
    return r.rows.map(e => {
      let detail, sub = '';
      const t = d => d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';
      if (e.kind === 'charge') {
        detail = e.memo + (e.farm_name ? ' · ' + e.farm_name : '');
        if (e.rate_type === 'hour') sub = `${t(e.start_at)}–${t(e.end_at)}${e.break_minutes ? `, थांबा ${e.break_minutes} मि.` : ''} · ${Math.floor(e.billable_minutes / 60)} तास ${e.billable_minutes % 60} मि. × ${B.formatPaise(e.applied_rate_paise)}/तास`;
        else if (e.rate_type === 'fixed') sub = 'ठराविक दर';
        else sub = `${(e.qty_hundredths / 100)} ${e.rate_type === 'acre' ? 'एकर' : 'खेपा'} × ${B.formatPaise(e.applied_rate_paise)}`;
        if (e.meter_start != null && e.meter_end != null) sub += ` · मीटर ${e.meter_start}–${e.meter_end}`;
        if (e.rate_override_reason) sub += ` · दर बदल: ${e.rate_override_reason}`;
      } else if (e.kind === 'payment') { detail = 'रक्कम जमा · ' + (MODE_MR[e.mode] || e.mode); sub = e.reference || ''; }
      else { detail = (e.amount_paise < 0 ? 'बिल रद्द/दुरुस्ती' : 'जमा रद्द') + (e.rev_impl ? ' · ' + e.rev_impl : e.rev_mode ? ' · ' + (MODE_MR[e.rev_mode] || '') : ''); sub = e.memo || ''; }
      return { id: e.id, date: e.entry_date, kind: e.kind, detail, sub, amountPaise: e.amount_paise, debit: e.amount_paise > 0 ? e.amount_paise : 0, credit: e.amount_paise < 0 ? -e.amount_paise : 0, jobId: e.job_id, paymentId: e.payment_id };
    });
  }
  async function buildStatement(c, biz, farmerId, kind, from, to) {
    const bizRow = (await c.query('select b.*, u.mobile from businesses b join owner_users u on u.business_id=b.id where b.id=$1 limit 1', [biz])).rows[0];
    const f = await farmerOf(c, biz, farmerId);
    const opening = from ? (await c.query('select coalesce(sum(amount_paise),0)::bigint s from ledger_entries where business_id=$1 and farmer_id=$2 and entry_date < $3', [biz, f.id, from])).rows[0].s : 0;
    const rows = await ledgerRows(c, biz, f.id, from, to);
    let run = opening; rows.forEach(r => { run += r.amountPaise; r.balance = run; });
    return { kind, from, to, opening, closing: run, totals: { debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) }, rows,
      business: { name: bizRow.name, owner_name: bizRow.owner_name, village: bizRow.village, upi: bizRow.upi, mobile: bizRow.mobile }, farmer: { name: f.name, village: f.village, mobile: f.mobile },
      generatedAt: new Date().toISOString(), generatedAtText: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) };
  }
  async function statementRange(c, biz, farmerId, kind, body) {
    const to = date(body.to || todayIST(), 'to');
    if (kind === 'all') return { from: null, to };
    if (kind === 'range') { const from = date(body.from, 'from'); if (from > to) throw new HttpError(400, 'RANGE_INVALID'); return { from, to }; }
    if (kind === 'since_last') {
      const last = (await c.query('select to_date from statements where business_id=$1 and farmer_id=$2 order by created_at desc limit 1', [biz, farmerId])).rows[0];
      if (!last) return { from: null, to };
      const d = new Date(last.to_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); const from = d.toISOString().slice(0, 10);
      return { from: from > to ? to : from, to };
    }
    throw new HttpError(400, 'KIND');
  }
  app.get('/api/farmers/:id/ledger', owner, h(async (req, res) => {
    const f = await farmerOf(pool, req.biz, req.params.id);
    const rows = await ledgerRows(pool, req.biz, f.id, null, null); let run = 0; rows.forEach(r => { run += r.amountPaise; r.balance = run; });
    res.json({ farmer: f, rows, ...B.summarize(rows) });
  }));
  app.post('/api/farmers/:id/statements', owner, mut(async (req, c) => {
    const f = await farmerOf(c, req.biz, req.params.id);
    const kind = req.body.kind; const { from, to } = await statementRange(c, req.biz, f.id, kind, req.body);
    const s = await buildStatement(c, req.biz, f.id, kind, from, to);
    s.number = 1 + (await c.query('select count(*)::int n from statements where business_id=$1 and farmer_id=$2', [req.biz, f.id])).rows[0].n;
    const row = (await c.query('insert into statements(id,business_id,farmer_id,kind,from_date,to_date,opening_paise,closing_paise,snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,farmer_id,kind,from_date,to_date,opening_paise,closing_paise,created_at',
      [uuid(req.body.id, 'id'), req.biz, f.id, kind, from, to, s.opening, s.closing, JSON.stringify(s)])).rows[0];
    return { status: 201, body: { statement: row, summary: { opening: s.opening, closing: s.closing, totals: s.totals, rows: s.rows.length } } };
  }));
  app.get('/api/statements/:id/pdf', owner, h(async (req, res) => {
    const s = await one(pool, 'select * from statements where id=$1 and business_id=$2', [uuid(req.params.id, 'id'), req.biz], 'STATEMENT_NOT_FOUND');
    const buf = await pdf.renderPDF(pdf.statementHTML(s.snapshot, { reprint: req.query.reprint === '1', lang: req.query.lang }));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': disposition(`hisab-${s.snapshot.farmer.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${s.to_date}.pdf`), 'Cache-Control': 'private, no-store' }).send(buf);
  }));
  app.get('/api/audit', owner, h(async (req, res) => {
    const r = await pool.query('select id,actor,action,entity,entity_id,reason,before,after,created_at from audit_log where business_id=$1 and ($2::uuid is null or entity_id=$2) order by id desc limit 200', [req.biz, uuid(req.query.entityId, 'entityId', true)]);
    res.json(r.rows);
  }));
  app.get('/api/questions', owner, h(async (req, res) => {
    res.json((await pool.query('select q.*, f.name farmer_name from farmer_questions q join farmers f on f.id=q.farmer_id where q.business_id=$1 order by q.created_at desc limit 100', [req.biz])).rows);
  }));
  app.get('/api/export', owner, h(async (req, res) => {
    const out = {}; for (const t of ['businesses', 'tractors', 'implements', 'farmers', 'farms', 'jobs', 'payments', 'ledger_entries', 'statements', 'audit_log'])
      out[t] = (await pool.query(`select * from ${t} where ${t === 'businesses' ? 'id' : 'business_id'}=$1`, [req.biz])).rows;
    res.set('Content-Disposition', `attachment; filename="tractor-hisab-export-${todayIST()}.json"`).json({ exportedAt: new Date().toISOString(), ...out });
  }));

  // ================= FARMER PORTAL (read-only on money) =================
  app.post('/api/farmer/otp/request', h(async (req, res) => {
    const m = mobile(req.body.mobile);
    await limit('otp-ip:' + req.ip, 20, 3600); await limit('otp:' + m, 3, 600);
    const linked = await pool.query('select 1 from farmers where mobile=$1 limit 1', [m]);
    let devCode;
    if (linked.rowCount) {
      const code = String(crypto.randomInt(100000, 1000000));
      await pool.query("insert into farmer_otps(mobile,code_hash,expires_at) values ($1,$2, now() + interval '5 minutes')", [m, sha(code + m + SECRET)]);
      await otp.send(env, m, code);
      if (otpProvider === 'dev' && !prod) devCode = code;
    }
    res.json({ ok: true, devCode }); // same response whether or not the number is registered
  }));
  app.post('/api/farmer/otp/verify', h(async (req, res) => {
    const m = mobile(req.body.mobile); const code = String(req.body.code || '');
    const r = await pool.query('select * from farmer_otps where mobile=$1 and consumed_at is null order by created_at desc limit 1', [m]);
    const o = r.rows[0];
    if (!o || new Date(o.expires_at) < new Date()) throw new HttpError(400, 'OTP_EXPIRED');
    if (o.attempts >= 5) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    const good = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(sha(code + m + SECRET)), Buffer.from(o.code_hash));
    if (!good) { await pool.query('update farmer_otps set attempts=attempts+1 where id=$1', [o.id]); throw new HttpError(400, 'OTP_WRONG'); }
    await pool.query('update farmer_otps set consumed_at=now() where id=$1', [o.id]);
    await newSession(res, { kind: 'farmer', farmer_mobile: m }, 1);
    res.json({ ok: true });
  }));
  app.get('/api/farmer/businesses', farmerAuth, h(async (req, res) => {
    const r = await pool.query('select f.id farmer_id, f.name farmer_name, b.name business_name, b.owner_name, b.village from farmers f join businesses b on b.id=f.business_id where f.mobile=$1 order by b.name', [req.session.farmer_mobile]);
    res.json(r.rows);
  }));
  app.post('/api/farmer/select', farmerAuth, h(async (req, res) => {
    const id = uuid(req.body.farmerId, 'farmerId');
    const r = await pool.query('select id from farmers where id=$1 and mobile=$2', [id, req.session.farmer_mobile]);
    if (!r.rowCount) throw new HttpError(404, 'NOT_FOUND');
    await pool.query('update sessions set selected_farmer_id=$2 where id=$1', [req.session.id, id]);
    res.json({ ok: true, farmerId: id });
  }));
  async function farmerCtx(req) {
    const id = req.session.selected_farmer_id; if (!id) throw new HttpError(409, 'SELECT_BUSINESS');
    const f = (await pool.query('select * from farmers where id=$1 and mobile=$2', [id, req.session.farmer_mobile])).rows[0];
    if (!f) throw new HttpError(403, 'FORBIDDEN'); return f;
  }
  app.get('/api/farmer/summary', farmerAuth, h(async (req, res) => {
    const f = await farmerCtx(req);
    const s = await buildStatement(pool, f.business_id, f.id, 'all', null, todayIST());
    res.json({ farmerId: f.id, business: s.business, farmer: s.farmer, rows: s.rows, ...B.summarize(s.rows.map(r => ({ amountPaise: r.amountPaise }))) });
  }));
  app.get('/api/farmer/statement.pdf', farmerAuth, h(async (req, res) => {
    const f = await farmerCtx(req);
    const kind = req.query.from ? 'range' : 'all';
    const { from, to } = await statementRange(pool, f.business_id, f.id, kind, { from: req.query.from, to: req.query.to });
    const s = await buildStatement(pool, f.business_id, f.id, kind, from, to); // not saved: farmer downloads never change records
    const buf = await pdf.renderPDF(pdf.statementHTML(s, { lang: req.query.lang === 'hi' ? 'hi' : 'mr' }));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': disposition(`hisab-${to}.pdf`), 'Cache-Control': 'private, no-store' }).send(buf);
  }));
  app.post('/api/farmer/questions', farmerAuth, h(async (req, res) => {
    const f = await farmerCtx(req); await limit('q:' + f.id, 10, 3600);
    const q = (await pool.query('insert into farmer_questions(business_id,farmer_id,message) values ($1,$2,$3) returning id,created_at', [f.business_id, f.id, str(req.body.message, 'message', 1, 1000)])).rows[0];
    res.status(201).json(q);
  }));

  app.get('/healthz', h(async (req, res) => { await pool.query('select 1'); res.json({ ok: true }); }));

  // ---- static PWA ----
  const pub = path.join(__dirname, '..', 'public');
  app.get('/billing.js', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'billing.js')));
  app.use(express.static(pub, { setHeaders: (res, p) => { if (/sw\.js$|index\.html$|manifest/.test(p)) res.set('Cache-Control', 'no-cache'); } }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(pub, 'index.html')));

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ code: err.code, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ code: 'BAD_JSON' });
    if (err.code === '23505') return res.status(409).json({ code: 'DUPLICATE' });
    if (err.code === '23503') return res.status(400).json({ code: 'REFERENCE_INVALID' });
    if (err.code === '23514') return res.status(400).json({ code: 'CONSTRAINT', details: { constraint: err.constraint } });
    if (err.status) return res.status(err.status).json({ code: err.code || 'ERROR' });
    console.error(err); res.status(500).json({ code: 'SERVER_ERROR' });
  });
  return app;
}
// RFC 5987: ASCII fallback + UTF-8 name so Marathi filenames are valid in headers.
function disposition(name) { return `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`; }
function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }

module.exports = { createApp, HttpError, hashPassword, verifyPassword };
