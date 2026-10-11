# ट्रॅक्टर हिशोब · Tractor Hisab

Work, billing and payment records for tractor owners, with a read-only OTP portal for farmers.
Marathi / Hindi / English. Node.js 20+, Express, PostgreSQL 14+, offline-first PWA.

## Key rules
- Money is integer paise; charge = billable minutes × rate ÷ 60, half-up to the paisa.
- Billable minutes = clock minutes (end − start) minus breaks you enter. Meter readings are reference only.
- Each job stores its applied rate; later rate changes never alter past charges. Overrides need confirmation + reason (audited).
- Ledger is append-only (DB triggers). Each charge/payment is recorded once (unique indexes + idempotency keys).
  Corrections add a reversal + new entry; originals are preserved.
- Statements are saved snapshots; generating/downloading never changes balances.

## Run locally
```bash
npm install
createdb tractor_hisab
export DATABASE_URL=postgres://localhost:5432/tractor_hisab NODE_ENV=development OTP_PROVIDER=dev SESSION_SECRET=dev
export CHROMIUM_PATH=/path/to/chromium   # needed for PDF statements
npm start            # runs migrations, serves http://localhost:3000
```
Farmer portal: http://localhost:3000/farmer (with `OTP_PROVIDER=dev` the code is shown on screen; never in production).

## Tests
```bash
export TEST_DATABASE_URL=postgres://localhost:5432/th_test   # will be WIPED
npm test                 # billing + API integration tests (real PostgreSQL)
export E2E_DATABASE_URL=postgres://localhost:5432/th_e2e     # will be WIPED
npm run test:e2e         # mobile UI end-to-end in Chromium
```

## Production notes
- Required: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `CHROMIUM_PATH`, Noto Sans Devanagari fonts on the server.
- Farmer login stays disabled until `OTP_PROVIDER=msg91` with DLT-approved template is configured.
- Serve over HTTPS (session cookie is `Secure`, `__Host-` prefixed in production).
- Backup: `pg_dump -Fc "$DATABASE_URL" > backup.dump` · Restore: `pg_restore --clean --no-owner -d "$TARGET_URL" backup.dump`.

## Status (see handover)
Billing tests 21/21 and API tests 17/17 pass. E2E owner flow passes up to the language-switch step (open issue).
Not yet included: Dockerfile, GitHub Actions workflow, deployment, demo seed script.
