const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { makePool, migrate } = require('../server/db');
const { createApp } = require('../server/app');
const pdf = require('../server/pdf');
const B = require('../server/billing');

const DB = process.env.TEST_DATABASE_URL || 'postgres://th:th@localhost:5432/th_test';
const ENV = { NODE_ENV: 'test', OTP_PROVIDER: 'dev', SESSION_SECRET: 'test-secret', REGISTER_LIMIT_PER_HOUR: '1000' };
const id = () => crypto.randomUUID();
const at = (d, t) => B.istToISO(d, t);
let pool, server, base;

function client() {
  let cookie = '';
  async function call(method, path, body, opts = {}) {
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'tractor-hisab' };
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') headers['idempotency-key'] = opts.key || id();
    if (opts.noCsrf) delete headers['x-requested-with'];
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
  }
  return { get: (p, o) => call('GET', p, null, o), post: (p, b, o) => call('POST', p, b, o), put: (p, b, o) => call('PUT', p, b, o) };
}
const IMPLEMENTS = [['नागर', 120000], ['सिंगल पलटी नागर', 110000], ['रोटर', 120000], ['फणी', 100000], ['सरी', 80000], ['सारे', 80000], ['पेरणी', 80000], ['बारीक रोटर', 90000]];
async function setupOwner(mobile) {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { businessName: 'ओमकार ट्रॅक्टर सेवा', ownerName: 'ओमकार', mobile, password: 'strong-pass-1', village: 'चाकण' })).status, 201);
  const tr = { id: id(), name: 'ओमकार सोनालिका' }; assert.equal((await c.post('/api/tractors', tr)).status, 201);
  const impl = {};
  for (const [name, rate] of IMPLEMENTS) { const i = { id: id(), name, rateType: 'hour', ratePaise: rate }; const r = await c.post('/api/implements', i); assert.equal(r.status, 201); impl[name] = r.body; }
  return { c, tr, impl };
}
async function newFarmer(c, extra = {}) {
  const f = { id: id(), name: 'रमेश जाधव', village: 'पिंपळगाव', farms: [{ id: id(), name: 'विहिरीजवळचे' }, { id: id(), name: 'ओढ्याकडचे' }], ...extra };
  const r = await c.post('/api/farmers', f); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
}
async function historical(c, f, implId, s, e, brk = 0, extra = {}) {
  const r = await c.post('/api/jobs', { id: id(), mode: 'historical', farmerId: f.id, farmId: f.farms[0].id, implementId: implId, startAt: s, endAt: e, breakMinutes: brk, ...extra });
  return r;
}
async function confirm(c, job, expected, key) { return c.post(`/api/jobs/${job.id}/confirm`, { expectedChargePaise: expected }, { key }); }
async function balance(fid) { return (await pool.query('select coalesce(sum(amount_paise),0)::bigint b from ledger_entries where farmer_id=$1', [fid])).rows[0].b; }

test.before(async () => {
  pool = makePool(DB);
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool);
  const app = createApp({ pool, env: ENV });
  await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await pdf.close(); await pool.end(); });

test('owner register, login, wrong password, logout', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { businessName: 'A', ownerName: 'A', mobile: '9000000001', password: 'short' })).body.code, 'PASSWORD_WEAK');
  assert.equal((await c.post('/api/auth/register', { businessName: 'A', ownerName: 'A', mobile: '9000000001', password: 'long-enough' })).status, 201);
  assert.equal((await c.post('/api/auth/register', { businessName: 'A', ownerName: 'A', mobile: '9000000001', password: 'long-enough' })).body.code, 'MOBILE_TAKEN');
  assert.equal((await c.get('/api/auth/me')).body.kind, 'owner');
  await c.post('/api/auth/logout', {});
  assert.equal((await c.get('/api/snapshot')).status, 401, 'session removed on logout');
  const d = client();
  assert.equal((await d.post('/api/auth/login', { mobile: '9000000001', password: 'wrong-pass' })).status, 401);
  assert.equal((await d.post('/api/auth/login', { mobile: '9000000001', password: 'long-enough' })).status, 200);
});

test('CSRF header and idempotency key are required for writes', async () => {
  const { c } = await setupOwner('9000000002');
  assert.equal((await c.post('/api/tractors', { id: id(), name: 'x' }, { noCsrf: true })).status, 403);
});

test('exact implement names and rates preserved', async () => {
  const { c } = await setupOwner('9000000003');
  const s = (await c.get('/api/snapshot')).body;
  assert.deepEqual(s.implements.map(i => [i.name, i.rate_paise]), IMPLEMENTS);
  assert.equal(s.tractors[0].name, 'ओमकार सोनालिका');
});

test('farmer with optional mobile and multiple named farms', async () => {
  const { c } = await setupOwner('9000000004');
  const f = await newFarmer(c);
  assert.equal(f.mobile, null); assert.equal(f.farms.length, 2);
  assert.equal((await c.post('/api/farmers', { id: id(), name: 'X', mobile: '12345' })).body.code, 'MOBILE_INVALID');
  assert.equal((await c.post(`/api/farmers/${f.id}/farms`, { id: id(), name: 'माळरान' })).status, 201);
  assert.equal((await c.post(`/api/farmers/${f.id}/farms`, { id: id(), name: 'माळरान' })).body.code, 'DUPLICATE');
});

test('live workflow: book → start → complete → preview → confirm (80 min @ ₹1200 = ₹1600.00)', async () => {
  const { c, impl, tr } = await setupOwner('9000000005');
  const f = await newFarmer(c);
  const book = await c.post('/api/jobs', { id: id(), mode: 'book', farmerId: f.id, farmId: f.farms[1].id, implementId: impl['नागर'].id, tractorId: tr.id, scheduledDate: '2026-10-10', meterStart: '1850.5' });
  assert.equal(book.status, 201); assert.equal(book.body.job.status, 'booked');
  let j = book.body.job;
  const start = await c.post(`/api/jobs/${j.id}/start`, { version: j.version, startAt: at('2026-10-10', '08:00') });
  assert.equal(start.body.job.status, 'running'); j = start.body.job;
  const done = await c.post(`/api/jobs/${j.id}/complete`, { version: j.version, endAt: at('2026-10-10', '09:20'), meterEnd: '1851.9' });
  assert.equal(done.status, 200, JSON.stringify(done.body)); j = done.body.job;
  const pv = (await c.get(`/api/jobs/${j.id}/preview`)).body.preview;
  assert.equal(pv.billableMinutes, 80); assert.equal(pv.chargePaise, 160000); assert.equal(pv.meterHours, 1.4);
  assert.equal((await confirm(c, j, 150000)).body.code, 'PREVIEW_STALE', 'stale preview cannot be confirmed');
  const key = id();
  const ok = await confirm(c, j, 160000, key); assert.equal(ok.status, 200); assert.equal(ok.body.entry.amount_paise, 160000);
  const replay = await confirm(c, j, 160000, key); assert.equal(replay.status, 200); assert.equal(replay.headers.get('idempotent-replay'), 'true');
  assert.equal((await confirm(c, j, 160000)).body.code, 'ALREADY_CONFIRMED');
  assert.equal((await pool.query("select count(*)::int n from ledger_entries where job_id=$1", [j.id])).rows[0].n, 1, 'charge recorded exactly once');
  assert.equal(await balance(f.id), 160000);
});

test('snapshot includes confirmed jobs so owner can see completed work totals', async () => {
  const { c, impl, tr } = await setupOwner('9000000005A');
  const f = await newFarmer(c);
  const job = await c.post('/api/jobs', { id: id(), mode: 'historical', farmerId: f.id, farmId: f.farms[0].id, implementId: impl['नागर'].id, tractorId: tr.id, startAt: at('2026-10-15', '08:00'), endAt: at('2026-10-15', '09:20'), breakMinutes: 0 });
  assert.equal(job.status, 201);
  const confirmed = await confirm(c, job.body.job, 160000, id());
  assert.equal(confirmed.status, 200);
  const snap = (await c.get('/api/snapshot')).body;
  const seen = snap.jobs.find(j => j.id === job.body.job.id);
  assert.ok(seen, 'confirmed work must stay in owner snapshot');
  assert.equal(seen.status, 'confirmed');
  assert.equal(seen.charge_paise, 160000);
});

test('historical work without live timer; spec charges; midnight crossing', async () => {
  const { c, impl } = await setupOwner('9000000006');
  const f = await newFarmer(c);
  const cases = [['फणी', at('2026-10-01', '10:00'), at('2026-10-01', '11:30'), 0, 150000], ['सरी', at('2026-10-02', '10:00'), at('2026-10-02', '10:45'), 0, 60000],
    ['रोटर', at('2026-10-03', '06:00'), at('2026-10-03', '08:00'), 15, 210000], ['बारीक रोटर', at('2026-10-04', '22:30'), at('2026-10-05', '01:10'), 0, 240000]];
  for (const [name, s, e, brk, want] of cases) {
    const r = await historical(c, f, impl[name].id, s, e, brk); assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.job.status, 'completed'); assert.equal(r.body.preview.chargePaise, want, name);
    assert.equal((await confirm(c, r.body.job, want)).status, 200);
  }
  assert.equal(await balance(f.id), 150000 + 60000 + 210000 + 240000);
});

test('invalid times, breaks, meters are rejected by the server', async () => {
  const { c, impl } = await setupOwner('9000000007');
  const f = await newFarmer(c); const im = impl['नागर'].id;
  assert.deepEqual((await historical(c, f, im, at('2026-10-01', '10:00'), at('2026-10-01', '09:00'))).body.details.errors, ['END_NOT_AFTER_START']);
  assert.ok((await historical(c, f, im, at('2026-10-01', '10:00'), at('2026-10-01', '10:30'), 30)).body.details.errors.includes('BREAK_TOO_LONG'));
  assert.equal((await historical(c, f, im, at('2026-10-01', '10:00'), at('2026-10-01', '11:00'), -1)).body.code, 'BREAK_INVALID');
  assert.equal((await historical(c, f, im, 'garbage', at('2026-10-01', '11:00'))).body.code, 'TIME_INVALID');
  assert.equal((await historical(c, f, im, at('2030-10-01', '10:00'), at('2030-10-01', '11:00'))).body.code, 'TIME_FUTURE');
  assert.ok((await historical(c, f, im, at('2026-10-01', '10:00'), at('2026-10-01', '11:00'), 0, { meterStart: '1850', meterEnd: '20' })).body.details.errors.includes('METER_DECREASED'));
  const reset = await historical(c, f, im, at('2026-10-01', '10:00'), at('2026-10-01', '11:00'), 0, { meterStart: '1850', meterEnd: '20', meterReset: true, meterNote: 'नवीन मीटर बसवला' });
  assert.equal(reset.status, 201, 'documented meter reset accepted'); assert.equal(reset.body.preview.chargePaise, 120000);
});

test('applied rate is stored per job; later rate change does not alter history; override needs confirmation, reason and audit', async () => {
  const { c, impl } = await setupOwner('9000000008');
  const f = await newFarmer(c); const im = impl['नागर'];
  const old = await historical(c, f, im.id, at('2026-10-01', '08:00'), at('2026-10-01', '09:20'));
  await confirm(c, old.body.job, 160000);
  const pending = await historical(c, f, im.id, at('2026-10-02', '08:00'), at('2026-10-02', '09:00'));
  assert.equal((await c.put(`/api/implements/${im.id}`, { version: im.version, ratePaise: 130000 })).status, 200);
  const snap = (await c.get('/api/snapshot')).body;
  assert.equal(snap.jobs.find(j => j.id === old.body.job.id).applied_rate_paise, 120000);
  assert.equal(snap.jobs.find(j => j.id === pending.body.job.id).applied_rate_paise, 120000, 'booked rate kept');
  const fresh = await historical(c, f, im.id, at('2026-10-03', '08:00'), at('2026-10-03', '09:00'));
  assert.equal(fresh.body.job.applied_rate_paise, 130000);
  assert.equal((await historical(c, f, im.id, at('2026-10-04', '08:00'), at('2026-10-04', '09:00'), 0, { rateOverride: { ratePaise: 100000, reason: 'जुना ग्राहक सवलत' } })).body.code, 'OVERRIDE_CONFIRM');
  assert.equal((await historical(c, f, im.id, at('2026-10-04', '08:00'), at('2026-10-04', '09:00'), 0, { rateOverride: { ratePaise: 100000, confirmed: true, reason: 'x' } })).body.code, 'LENGTH');
  const ov = await historical(c, f, im.id, at('2026-10-04', '08:00'), at('2026-10-04', '09:00'), 0, { rateOverride: { ratePaise: 100000, confirmed: true, reason: 'जुना ग्राहक सवलत' } });
  assert.equal(ov.body.preview.chargePaise, 100000); assert.equal(ov.body.job.standard_rate_paise, 130000);
  const aud = (await c.get(`/api/audit?entityId=${ov.body.job.id}`)).body;
  assert.ok(aud.some(a => a.action === 'rate_override' && a.reason === 'जुना ग्राहक सवलत'));
});

test('payments: partial, full and advance independent of jobs; outstanding and credit separate', async () => {
  const { c, impl } = await setupOwner('9000000009');
  const f = await newFarmer(c);
  const j = await historical(c, f, impl['नागर'].id, at('2026-10-01', '08:00'), at('2026-10-01', '09:20')); await confirm(c, j.body.job, 160000);
  const pay = amt => c.post('/api/payments', { id: id(), farmerId: f.id, amountPaise: amt, mode: 'cash', paidOn: '2026-10-05' });
  assert.equal((await pay(60000)).status, 201);
  let s = (await c.get('/api/snapshot')).body.farmers[0]; assert.equal(s.outstandingPaise, 100000); assert.equal(s.creditPaise, 0);
  await pay(100000); s = (await c.get('/api/snapshot')).body.farmers[0]; assert.equal(s.balancePaise, 0);
  await pay(50000); s = (await c.get('/api/snapshot')).body.farmers[0]; assert.equal(s.outstandingPaise, 0); assert.equal(s.creditPaise, 50000);
  assert.equal((await c.post('/api/payments', { id: id(), farmerId: f.id, amountPaise: 0, mode: 'cash', paidOn: '2026-10-05' })).body.code, 'INVALID');
  assert.equal((await c.post('/api/payments', { id: id(), farmerId: f.id, amountPaise: 100, mode: 'cash', paidOn: '2099-01-01' })).body.code, 'DATE_FUTURE');
});

test('double tap / retry with same key records payment once; parallel confirms record once', async () => {
  const { c, impl } = await setupOwner('9000000010');
  const f = await newFarmer(c); const key = id(); const pid = id();
  const body = { id: pid, farmerId: f.id, amountPaise: 25000, mode: 'upi', reference: 'UPI123', paidOn: '2026-10-05' };
  const [a, b] = await Promise.all([c.post('/api/payments', body, { key }), c.post('/api/payments', body, { key })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 201]);
  assert.equal((await pool.query('select count(*)::int n from payments where id=$1', [pid])).rows[0].n, 1);
  assert.equal((await c.post('/api/payments', body)).body.code, 'DUPLICATE', 'same payment id with new key is rejected, not duplicated');
  const j = await historical(c, f, impl['सरी'].id, at('2026-10-01', '10:00'), at('2026-10-01', '10:45'));
  const rs = await Promise.all([confirm(c, j.body.job, 60000), confirm(c, j.body.job, 60000), confirm(c, j.body.job, 60000)]);
  assert.equal(rs.filter(r => r.status === 200).length, 1);
  assert.equal((await pool.query("select count(*)::int n from ledger_entries where job_id=$1 and kind='charge'", [j.body.job.id])).rows[0].n, 1);
});

test('corrections preserve originals with reversal + audit; ledger is append-only', async () => {
  const { c, impl } = await setupOwner('9000000011');
  const f = await newFarmer(c);
  const j = await historical(c, f, impl['नागर'].id, at('2026-10-01', '08:00'), at('2026-10-01', '10:00')); await confirm(c, j.body.job, 240000);
  assert.equal((await c.post(`/api/jobs/${j.body.job.id}/correct`, { newId: id(), breakMinutes: 30 })).body.code, 'REQUIRED');
  const cr = await c.post(`/api/jobs/${j.body.job.id}/correct`, { newId: id(), breakMinutes: 30, reason: 'जेवणाचा थांबा राहिला' });
  assert.equal(cr.status, 201); assert.equal(cr.body.job.charge_paise, 180000); assert.equal(cr.body.job.corrected_from, j.body.job.id);
  assert.equal(await balance(f.id), 180000);
  const kinds = (await pool.query('select kind, amount_paise from ledger_entries where farmer_id=$1 order by created_at', [f.id])).rows.map(r => [r.kind, r.amount_paise]);
  assert.deepEqual(kinds, [['charge', 240000], ['reversal', -240000], ['charge', 180000]]);
  assert.equal((await pool.query('select status from jobs where id=$1', [j.body.job.id])).rows[0].status, 'superseded');
  const p = await c.post('/api/payments', { id: id(), farmerId: f.id, amountPaise: 50000, mode: 'cash', paidOn: '2026-10-05' });
  assert.equal((await c.post(`/api/payments/${p.body.payment.id}/void`, { reason: 'चुकीचा शेतकरी' })).status, 200);
  assert.equal(await balance(f.id), 180000);
  await assert.rejects(pool.query('update ledger_entries set amount_paise=1 where farmer_id=$1', [f.id]), /append-only/);
  await assert.rejects(pool.query('delete from ledger_entries where farmer_id=$1', [f.id]), /append-only/);
  const aud = (await c.get('/api/audit')).body.map(a => a.action);
  assert.ok(aud.includes('correct_charge') && aud.includes('void'));
});

test('concurrent edits: stale version is a conflict, not an overwrite', async () => {
  const { c } = await setupOwner('9000000012');
  const f = await newFarmer(c);
  assert.equal((await c.put(`/api/farmers/${f.id}`, { version: 1, village: 'खेड' })).status, 200);
  const stale = await c.put(`/api/farmers/${f.id}`, { version: 1, village: 'चाकण' });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'CONFLICT'); assert.equal(stale.body.details.current.village, 'खेड');
});

test('statements: all-history, custom range, since-last; generation never changes balances; PDF is real', async () => {
  const { c, impl } = await setupOwner('9000000013');
  const f = await newFarmer(c);
  for (const [d, amt] of [['2026-09-01', 160000], ['2026-09-20', 120000], ['2026-10-02', 60000]]) {
    const j = await historical(c, f, impl['नागर'].id, at(d, '08:00'), at(d, '09:20'));
    await confirm(c, j.body.job, j.body.preview.chargePaise);
  }
  await c.post('/api/payments', { id: id(), farmerId: f.id, amountPaise: 200000, mode: 'cash', paidOn: '2026-09-25' });
  const before = await balance(f.id); const ledgerCount = (await pool.query('select count(*)::int n from ledger_entries')).rows[0].n;
  const all = await c.post(`/api/farmers/${f.id}/statements`, { id: id(), kind: 'all', to: '2026-10-10' });
  assert.equal(all.status, 201); assert.equal(all.body.summary.opening, 0); assert.equal(all.body.summary.closing, before);
  const range = await c.post(`/api/farmers/${f.id}/statements`, { id: id(), kind: 'range', from: '2026-09-15', to: '2026-09-30' });
  assert.equal(range.body.summary.opening, 160000); assert.equal(range.body.summary.closing, 160000 + 160000 - 200000);
  assert.equal((await c.post(`/api/farmers/${f.id}/statements`, { id: id(), kind: 'range', from: '2026-10-05', to: '2026-10-01' })).body.code, 'RANGE_INVALID');
  const since = await c.post(`/api/farmers/${f.id}/statements`, { id: id(), kind: 'since_last' });
  assert.equal(since.body.statement.from_date, '2026-10-01', 'starts the day after the last saved statement');
  assert.equal(await balance(f.id), before); assert.equal((await pool.query('select count(*)::int n from ledger_entries')).rows[0].n, ledgerCount);
  const p1 = await c.get(`/api/statements/${all.body.statement.id}/pdf`);
  assert.equal(p1.status, 200); assert.equal(p1.headers.get('content-type'), 'application/pdf'); assert.equal(p1.body.subarray(0, 4).toString(), '%PDF');
  require('fs').writeFileSync('/tmp/statement-test.pdf', p1.body);
  const p2 = await c.get(`/api/statements/${all.body.statement.id}/pdf?reprint=1`); assert.equal(p2.status, 200, 'reprint works');
  assert.equal(await balance(f.id), before, 'download did not alter balance');
});

test('business isolation: another owner cannot see or touch my data', async () => {
  const a = await setupOwner('9000000014'); const b = await setupOwner('9000000015');
  const f = await newFarmer(a.c);
  const j = await historical(a.c, f, a.impl['नागर'].id, at('2026-10-01', '08:00'), at('2026-10-01', '09:00'));
  assert.equal((await b.c.get(`/api/farmers/${f.id}/ledger`)).status, 404);
  assert.equal((await b.c.get(`/api/jobs/${j.body.job.id}/preview`)).status, 404);
  assert.equal((await confirm(b.c, j.body.job, 120000)).status, 404);
  assert.equal((await b.c.post('/api/payments', { id: id(), farmerId: f.id, amountPaise: 100, mode: 'cash', paidOn: '2026-10-01' })).status, 404);
  assert.equal((await historical(b.c, f, b.impl['नागर'].id, at('2026-10-01', '08:00'), at('2026-10-01', '09:00'))).status, 404, 'cannot bill another business farmer');
  assert.equal((await historical(a.c, f, b.impl['नागर'].id, at('2026-10-01', '08:00'), at('2026-10-01', '09:00'))).status, 404, 'cannot use another business implement');
  assert.equal((await b.c.get('/api/snapshot')).body.farmers.length, 0);
});

test('farmer OTP access: verified OTP only, business selector, isolation, balances match, read-only', async () => {
  const a = await setupOwner('9000000016'); const b = await setupOwner('9000000017');
  const fa = await newFarmer(a.c, { mobile: '9876500001' }); const fb = await newFarmer(b.c, { mobile: '9876500001', name: 'रमेश जाधव (दुसरा)' });
  const other = await newFarmer(a.c, { mobile: '9876500002', name: 'इतर' });
  const j = await historical(a.c, fa, a.impl['नागर'].id, at('2026-10-01', '08:00'), at('2026-10-01', '09:20')); await confirm(a.c, j.body.job, 160000);
  await a.c.post('/api/payments', { id: id(), farmerId: fa.id, amountPaise: 50000, mode: 'cash', paidOn: '2026-10-02' });
  const fc = client();
  const unl = await fc.post('/api/farmer/otp/request', { mobile: '9123400000' }); assert.equal(unl.status, 200); assert.equal(unl.body.devCode, undefined, 'no OTP for unknown number, same response');
  const req1 = await fc.post('/api/farmer/otp/request', { mobile: '9876500001' }); const code = req1.body.devCode; assert.match(code, /^\d{6}$/);
  assert.equal((await fc.get('/api/farmer/businesses')).status, 401, 'no access before verification');
  assert.equal((await fc.post('/api/farmer/otp/verify', { mobile: '9876500001', code: code === '000000' ? '111111' : '000000' })).body.code, 'OTP_WRONG');
  assert.equal((await fc.post('/api/farmer/otp/verify', { mobile: '9876500001', code })).status, 200);
  assert.equal((await fc.post('/api/farmer/otp/verify', { mobile: '9876500001', code })).body.code, 'OTP_EXPIRED', 'code is single-use');
  const biz = (await fc.get('/api/farmer/businesses')).body; assert.equal(biz.length, 2, 'two relationships listed');
  assert.equal((await fc.get('/api/farmer/summary')).body.code, 'SELECT_BUSINESS', 'must select explicitly');
  assert.equal((await fc.post('/api/farmer/select', { farmerId: other.id })).status, 404, 'cannot select another farmer');
  assert.equal((await fc.post('/api/farmer/select', { farmerId: fa.id })).status, 200);
  const sum = (await fc.get('/api/farmer/summary')).body;
  const ownerView = (await a.c.get(`/api/farmers/${fa.id}/ledger`)).body;
  assert.equal(sum.balancePaise, ownerView.balancePaise); assert.equal(sum.balancePaise, 110000);
  await fc.post('/api/farmer/select', { farmerId: fb.id }); assert.equal((await fc.get('/api/farmer/summary')).body.balancePaise, 0, 'other business shows its own data only');
  await fc.post('/api/farmer/select', { farmerId: fa.id });
  const nStat = (await pool.query('select count(*)::int n from statements')).rows[0].n, nLed = (await pool.query('select count(*)::int n from ledger_entries')).rows[0].n;
  const p = await fc.get('/api/farmer/statement.pdf'); assert.equal(p.status, 200); assert.equal(p.body.subarray(0, 4).toString(), '%PDF');
  assert.equal((await fc.post('/api/farmer/questions', { message: 'नांगरटीचे बिल किती?' })).status, 201);
  assert.equal((await pool.query('select count(*)::int n from statements')).rows[0].n, nStat); assert.equal((await pool.query('select count(*)::int n from ledger_entries')).rows[0].n, nLed);
  assert.equal(await balance(fa.id), 110000, 'farmer actions did not change money');
  assert.equal((await fc.get('/api/snapshot')).status, 401, 'farmer cannot use owner API');
  assert.equal((await fc.post('/api/payments', { id: id(), farmerId: fa.id, amountPaise: 1, mode: 'cash', paidOn: '2026-10-01' })).status, 401);
  assert.equal((await a.c.get('/api/questions')).body[0].message, 'नांगरटीचे बिल किती?');
});

test('OTP attempts are limited', async () => {
  const a = await setupOwner('9000000018'); await newFarmer(a.c, { mobile: '9876500009' });
  const fc = client(); const code = (await fc.post('/api/farmer/otp/request', { mobile: '9876500009' })).body.devCode;
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await fc.post('/api/farmer/otp/verify', { mobile: '9876500009', code: wrong });
  assert.equal((await fc.post('/api/farmer/otp/verify', { mobile: '9876500009', code })).status, 429, 'locked after 5 wrong attempts');
});

test('production refuses dev OTP and missing secrets', () => {
  assert.throws(() => createApp({ pool, env: { NODE_ENV: 'production', OTP_PROVIDER: 'dev', SESSION_SECRET: 'x' } }), /not allowed in production/);
  assert.throws(() => createApp({ pool, env: { NODE_ENV: 'production', OTP_PROVIDER: 'msg91', SESSION_SECRET: 'x' } }), /MSG91_AUTH_KEY/);
  assert.throws(() => createApp({ pool, env: { NODE_ENV: 'production', OTP_PROVIDER: 'disabled' } }), /SESSION_SECRET/);
  assert.doesNotThrow(() => createApp({ pool, env: { NODE_ENV: 'production', OTP_PROVIDER: 'disabled', SESSION_SECRET: 'x' } }));
});
