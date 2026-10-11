const { makePool, migrate } = require('./db');
const { createApp } = require('./app');
const pdf = require('./pdf');

async function main() {
  const pool = makePool(process.env.DATABASE_URL);
  if (process.env.MIGRATE_ON_START !== '0') { const a = await migrate(pool); if (a.length) console.log('migrations applied:', a.join(', ')); }
  const app = createApp({ pool });
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => console.log(`tractor-hisab listening on :${port} (${process.env.NODE_ENV || 'development'})`));
  const stop = async () => { server.close(); await pdf.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch(e => { console.error('startup failed:', e.message); process.exit(1); });
