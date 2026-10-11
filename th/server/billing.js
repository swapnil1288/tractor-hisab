/* Shared billing engine (server + browser). All money is integer paise. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Billing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_JOB_MINUTES = 24 * 60;
  const RATE_TYPES = ['hour', 'acre', 'trip', 'fixed'];

  // Exact integer division with half-up rounding (non-negative integer inputs).
  function divHalfUp(n, d) {
    const q = Math.floor(n / d), r = n - q * d;
    return 2 * r >= d ? q + 1 : q;
  }
  const isInt = v => Number.isSafeInteger(v);

  // "1234.5" -> 123450 paise. Rejects >2 decimals, negatives, junk.
  function rupeesToPaise(v) {
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(v.trim())) return null;
    const [r, p = ''] = v.trim().split('.');
    return Number(r) * 100 + Number((p + '00').slice(0, 2));
  }
  function formatPaise(p, opts) {
    const neg = p < 0; p = Math.abs(p);
    const r = Math.floor(p / 100), s = String(p % 100).padStart(2, '0');
    return (neg ? '-' : '') + ((opts && opts.symbol === false) ? '' : '₹') + r.toLocaleString('en-IN') + '.' + s;
  }
  const qtyToHundredths = v => { const p = rupeesToPaise(v); return p && p > 0 ? p : null; };

  // IST wall-clock date + time -> ISO string with +05:30. Returns null if invalid.
  function istToISO(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
    const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
    if (m < 1 || m > 12 || h > 23 || mi > 59) return null;
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
    return `${date}T${time}:00+05:30`;
  }

  /**
   * Billable minutes = whole clock minutes (end - start) minus explicitly entered breaks.
   * Meter readings are reference values and never change the charge.
   */
  function computeCharge(input) {
    const errors = [];
    const rateType = input.rateType || 'hour';
    const rate = input.ratePaise;
    if (!RATE_TYPES.includes(rateType)) errors.push('RATE_TYPE');
    if (!isInt(rate) || rate <= 0) errors.push('RATE_INVALID');
    let duration = null;
    const hasTime = input.startAt != null || input.endAt != null;
    if (hasTime || rateType === 'hour') {
      const s = input.startAt ? new Date(input.startAt) : null, e = input.endAt ? new Date(input.endAt) : null;
      if (!s || isNaN(s)) errors.push('START_INVALID');
      else if (!e || isNaN(e)) errors.push('END_INVALID');
      else {
        duration = Math.floor((e.getTime() - s.getTime()) / 60000);
        if (duration <= 0) errors.push('END_NOT_AFTER_START');
        else if (duration > MAX_JOB_MINUTES) errors.push('TOO_LONG');
      }
    }
    const brk = input.breakMinutes == null || input.breakMinutes === '' ? 0 : Number(input.breakMinutes);
    if (!isInt(brk) || brk < 0) errors.push('BREAK_INVALID');
    else if (duration != null && duration > 0 && brk >= duration) errors.push('BREAK_TOO_LONG');
    let billable = null, charge = null;
    if (!errors.length) {
      if (rateType === 'hour') { billable = duration - brk; charge = divHalfUp(billable * rate, 60); }
      else if (rateType === 'fixed') { charge = rate; billable = duration != null ? duration - brk : null; }
      else {
        const q = input.qtyHundredths;
        if (!isInt(q) || q <= 0) errors.push('QTY_INVALID');
        else { charge = divHalfUp(q * rate, 100); billable = duration != null ? duration - brk : null; }
      }
    }
    return { ok: !errors.length, errors, durationMinutes: duration, breakMinutes: isInt(brk) ? brk : null,
      billableMinutes: errors.length ? null : billable, chargePaise: errors.length ? null : charge };
  }

  // Meter readings: reference only. A decrease is allowed only as a documented reset.
  function checkMeter(m) {
    const errs = [];
    const num = v => (v === '' || v == null) ? null : (/^\d{1,7}(\.\d{1,2})?$/.test(String(v).trim()) ? Number(v) : NaN);
    const a = num(m.meterStart), b = num(m.meterEnd);
    if (Number.isNaN(a)) errs.push('METER_START_INVALID');
    if (Number.isNaN(b)) errs.push('METER_END_INVALID');
    if (!errs.length && a != null && b != null && b < a) {
      if (!m.meterReset) errs.push('METER_DECREASED');
      else if (!m.meterNote || String(m.meterNote).trim().length < 3) errs.push('METER_RESET_NOTE');
    }
    const hours = (!errs.length && a != null && b != null && b >= a) ? Math.round((b - a) * 100) / 100 : null;
    return { ok: !errs.length, errors: errs, meterStart: Number.isNaN(a) ? null : a, meterEnd: Number.isNaN(b) ? null : b, meterHours: hours };
  }

  // Positive balance = farmer owes owner; negative = credit (advance).
  function summarize(entries) {
    const balance = entries.reduce((s, e) => s + e.amountPaise, 0);
    return { balancePaise: balance, outstandingPaise: Math.max(0, balance), creditPaise: Math.max(0, -balance) };
  }

  return { divHalfUp, rupeesToPaise, formatPaise, qtyToHundredths, istToISO, computeCharge, checkMeter, summarize, RATE_TYPES, MAX_JOB_MINUTES };
});
