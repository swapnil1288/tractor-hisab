const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function makePool(url) {
  if (!url) throw new Error('DATABASE_URL is required');
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === 'require' ? { rejectUnauthorized: process.env.PGSSL_INSECURE === '1' ? false : true } : undefined;
  return new Pool({ connectionString: url, ssl, max: Number(process.env.PG_POOL_MAX || 10) });
}

async function tx(pool, fn) {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { try { await c.query('rollback'); } catch (_) {} throw e; }
  finally { c.release(); }
}

async function migrate(pool) {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map(r => r.name));
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await tx(pool, async c => { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('insert into schema_migrations(name) values ($1)', [f]); });
    applied.push(f);
  }
  return applied;
}

module.exports = { makePool, tx, migrate };

if (require.main === module) {
  const pool = makePool(process.env.DATABASE_URL);
  migrate(pool).then(a => { console.log(a.length ? 'applied: ' + a.join(', ') : 'schema up to date'); return pool.end(); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
