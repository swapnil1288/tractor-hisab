/*
 OTP delivery. Providers:
  - "dev": stores the code so tests / local dev can read it. Refused when NODE_ENV=production.
  - "msg91": MSG91 OTP template API (India). Needs MSG91_AUTH_KEY + MSG91_TEMPLATE_ID (DLT-approved).
 Phone-only login is never allowed: a session is created only after a code is verified.
*/
const lastDevCodes = new Map(); // mobile -> code (dev only)

function assertConfig(env) {
  const p = env.OTP_PROVIDER || 'disabled';
  if (env.NODE_ENV === 'production' && p === 'dev') throw new Error('OTP_PROVIDER=dev is not allowed in production');
  if (p === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required for OTP_PROVIDER=msg91');
  return p;
}

async function send(env, mobile, code) {
  const p = assertConfig(env);
  if (p === 'dev') { lastDevCodes.set(mobile, code); if (env.NODE_ENV !== 'test') console.log(`[dev-otp] ${mobile.slice(0, 2)}******${mobile.slice(-2)} code=${code}`); return; }
  if (p === 'msg91') {
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(env.MSG91_TEMPLATE_ID)}&mobile=91${mobile}&otp=${code}`;
    const r = await fetch(url, { method: 'POST', headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) throw Object.assign(new Error('OTP provider error ' + r.status), { status: 502 });
    return;
  }
  throw Object.assign(new Error('OTP login is not configured'), { status: 503, code: 'OTP_DISABLED' });
}

module.exports = { send, assertConfig, devCode: m => lastDevCodes.get(m) };
