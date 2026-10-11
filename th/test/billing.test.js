const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../server/billing.js');

const at = (d, t) => B.istToISO(d, t);
const hour = (s, e, rupeesPerHour, brk) => B.computeCharge({ rateType: 'hour', ratePaise: rupeesPerHour * 100, startAt: s, endAt: e, breakMinutes: brk });

test('spec: 80 min at ₹1200/h = ₹1600.00', () => {
  const r = hour(at('2026-10-10', '08:00'), at('2026-10-10', '09:20'), 1200);
  assert.equal(r.billableMinutes, 80); assert.equal(r.chargePaise, 160000); assert.equal(B.formatPaise(r.chargePaise), '₹1,600.00');
});
test('spec: 90 min at ₹1000/h = ₹1500.00', () => assert.equal(hour(at('2026-10-10', '10:00'), at('2026-10-10', '11:30'), 1000).chargePaise, 150000));
test('spec: 45 min at ₹800/h = ₹600.00', () => assert.equal(hour(at('2026-10-10', '10:00'), at('2026-10-10', '10:45'), 800).chargePaise, 60000));
test('spec: 120 min − 15 min break at ₹1200/h = ₹2100.00', () => {
  const r = hour(at('2026-10-10', '06:00'), at('2026-10-10', '08:00'), 1200, 15);
  assert.equal(r.billableMinutes, 105); assert.equal(r.chargePaise, 210000);
});
test('midnight crossing 22:30 → 01:10 next day = 160 min', () => {
  const r = hour(at('2026-10-10', '22:30'), at('2026-10-11', '01:10'), 900);
  assert.equal(r.billableMinutes, 160); assert.equal(r.chargePaise, 240000);
});
test('end before start rejected (negative duration)', () => assert.deepEqual(hour(at('2026-10-10', '10:00'), at('2026-10-10', '09:00'), 800).errors, ['END_NOT_AFTER_START']));
test('zero duration rejected', () => assert.ok(hour(at('2026-10-10', '10:00'), at('2026-10-10', '10:00'), 800).errors.includes('END_NOT_AFTER_START')));
test('more than 24h rejected', () => assert.ok(hour(at('2026-10-10', '10:00'), at('2026-10-11', '10:01'), 800).errors.includes('TOO_LONG')));
test('invalid dates and times rejected', () => {
  assert.equal(at('2026-02-30', '10:00'), null); assert.equal(at('2026-10-10', '24:00'), null);
  assert.equal(at('10-10-2026', '10:00'), null); assert.equal(at('2026-13-01', '10:00'), null);
  assert.ok(hour(null, at('2026-10-10', '10:00'), 800).errors.includes('START_INVALID'));
  assert.ok(hour(at('2026-10-10', '10:00'), 'not-a-date', 800).errors.includes('END_INVALID'));
});
test('break ≥ duration rejected', () => assert.ok(hour(at('2026-10-10', '10:00'), at('2026-10-10', '10:30'), 800, 30).errors.includes('BREAK_TOO_LONG')));
test('negative or fractional break rejected', () => {
  assert.ok(hour(at('2026-10-10', '10:00'), at('2026-10-10', '11:00'), 800, -5).errors.includes('BREAK_INVALID'));
  assert.ok(hour(at('2026-10-10', '10:00'), at('2026-10-10', '11:00'), 800, 2.5).errors.includes('BREAK_INVALID'));
});
test('invalid rate rejected', () => assert.ok(B.computeCharge({ rateType: 'hour', ratePaise: 0, startAt: at('2026-10-10', '10:00'), endAt: at('2026-10-10', '11:00') }).errors.includes('RATE_INVALID')));
test('half-paisa rounds up: 1 min at ₹1/h = ₹0.02', () => assert.equal(B.computeCharge({ rateType: 'hour', ratePaise: 100, startAt: at('2026-10-10', '10:00'), endAt: at('2026-10-10', '10:01') }).chargePaise, 2));
test('7 min at ₹1100/h = ₹128.33 exactly (two decimals)', () => assert.equal(B.formatPaise(hour(at('2026-10-10', '10:00'), at('2026-10-10', '10:07'), 1100).chargePaise), '₹128.33'));
test('live timer seconds truncate to whole minutes', () => assert.equal(B.computeCharge({ rateType: 'hour', ratePaise: 120000, startAt: '2026-10-10T08:00:00+05:30', endAt: '2026-10-10T09:20:59+05:30' }).billableMinutes, 80));
test('acre: 2.5 acres × ₹800 = ₹2000.00', () => assert.equal(B.computeCharge({ rateType: 'acre', ratePaise: 80000, qtyHundredths: B.qtyToHundredths('2.5') }).chargePaise, 200000));
test('acre requires a quantity', () => assert.ok(B.computeCharge({ rateType: 'acre', ratePaise: 80000 }).errors.includes('QTY_INVALID')));
test('rupee parsing is decimal-safe', () => {
  assert.equal(B.rupeesToPaise('0.1'), 10); assert.equal(B.rupeesToPaise('0.29'), 29); assert.equal(B.rupeesToPaise('1200'), 120000);
  assert.equal(B.rupeesToPaise('12.345'), null); assert.equal(B.rupeesToPaise('-5'), null); assert.equal(B.rupeesToPaise('abc'), null);
});
test('meter decrease requires a documented reset', () => {
  assert.ok(B.checkMeter({ meterStart: '1850.5', meterEnd: '12.0' }).errors.includes('METER_DECREASED'));
  assert.ok(B.checkMeter({ meterStart: '1850.5', meterEnd: '12.0', meterReset: true }).errors.includes('METER_RESET_NOTE'));
  assert.ok(B.checkMeter({ meterStart: '1850.5', meterEnd: '12.0', meterReset: true, meterNote: 'मीटर बदलला' }).ok);
  assert.equal(B.checkMeter({ meterStart: '1850.5', meterEnd: '1852.0' }).meterHours, 1.5);
});
test('meter readings never change the charge', () => {
  const r = B.computeCharge({ rateType: 'hour', ratePaise: 120000, startAt: at('2026-10-10', '08:00'), endAt: at('2026-10-10', '09:20'), meterStart: 1, meterEnd: 500 });
  assert.equal(r.chargePaise, 160000);
});
test('summary separates outstanding and credit', () => {
  assert.deepEqual(B.summarize([{ amountPaise: 160000 }, { amountPaise: -200000 }]), { balancePaise: -40000, outstandingPaise: 0, creditPaise: 40000 });
});
