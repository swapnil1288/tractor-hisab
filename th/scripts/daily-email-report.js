'use strict';

const nodemailer = require('nodemailer');
const { makePool, tx } = require('../server/db');

const env = process.env;
const dryRun = process.argv.includes('--dry-run');
const pool = makePool(env.DATABASE_URL);

const money = p => '₹' + (Number(p || 0) / 100).toFixed(2);
const hours = m =>
  `${Math.floor(m / 60)} तास ${Math.round(m % 60)} मिनिटे`;

function reportDate() {
  if (env.REPORT_DATE) {
    const d = env.REPORT_DATE;
    const parsed = new Date(d + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== d) {
      throw new Error('REPORT_DATE must be YYYY-MM-DD');
    }
    return d;
  }

  // Most recent scheduled 23:59 IST, even if this run starts after midnight.
  const shifted = new Date(Date.now() + 330 * 60000);
  if (shifted.getUTCHours() * 60 + shifted.getUTCMinutes() < 1439) {
    shifted.setUTCDate(shifted.getUTCDate() - 1);
  }
  return shifted.toISOString().slice(0, 10);
}

async function buildReport(c, b, date) {
  const cutoff = new Date(Math.min(
    Date.now(),
    new Date(date + 'T23:59:00+05:30').getTime()
  )).toISOString();

  const jobs = (await c.query(
    `select j.*, f.name as farmer_name, fm.name as farm_name,
            t.name as tractor_name
     from jobs j
     join farmers f on f.id=j.farmer_id
     left join farms fm on fm.id=j.farm_id
     left join tractors t on t.id=j.tractor_id
     where j.business_id=$1
       and j.status in ('completed','confirmed')
       and coalesce(
         (j.end_at at time zone 'Asia/Kolkata')::date,
         j.scheduled_date
       )=$2::date
       and j.updated_at <= $3::timestamptz
     order by j.end_at nulls last, j.created_at`,
    [b.id, date, cutoff]
  )).rows;

  const payments = (await c.query(
    `select p.*, f.name as farmer_name
     from payments p join farmers f on f.id=p.farmer_id
     where p.business_id=$1 and p.paid_on=$2::date
       and p.status='active' and p.created_at <= $3::timestamptz
     order by p.created_at`,
    [b.id, date, cutoff]
  )).rows;

  const balance = (await c.query(
    `select
       coalesce(sum(greatest(balance,0)),0)::bigint as due,
       coalesce(sum(greatest(-balance,0)),0)::bigint as advance
     from (
       select farmer_id, sum(amount_paise) as balance
       from ledger_entries
       where business_id=$1 and entry_date <= $2::date
         and created_at <= $3::timestamptz
       group by farmer_id
     ) x`,
    [b.id, date, cutoff]
  )).rows[0];

  let minutes = 0;
  for (const j of jobs) {
    if (j.start_at && j.end_at) {
      minutes += Math.max(
        0,
        Math.round(
          (new Date(j.end_at) - new Date(j.start_at)) / 60000
        ) - Number(j.break_minutes || 0)
      );
    }
  }

  const confirmed = jobs.filter(j => j.status === 'confirmed');
  const bill = confirmed.reduce(
    (sum, j) => sum + Number(j.charge_paise || 0), 0
  );
  const received = payments.reduce(
    (sum, p) => sum + Number(p.amount_paise), 0
  );

  const workLines = jobs.map((j, i) =>
    `${i + 1}. ${j.farmer_name} | शेत: ${j.farm_name || '—'}\n` +
    `   ट्रॅक्टर: ${j.tractor_name || '—'} | ${j.implement_name}\n` +
    `   ${j.status === 'confirmed'
      ? 'बिल: ' + money(j.charge_paise)
      : 'बिलाची पुष्टी बाकी'}`
  ).join('\n\n');

  const paymentLines = payments.map(p =>
    `${p.farmer_name}: ${money(p.amount_paise)} (${p.mode})`
  ).join('\n');

  return {
    subject: `ट्रॅक्टर हिशोब | ${date} | Daily Report`,
    text:
      `नमस्कार ${b.owner_name},\n\n` +
      `${b.name}\nदिनांक: ${date}\n\n` +
      `पूर्ण झालेले काम: ${jobs.length}\n` +
      `नोंदवलेला कामाचा वेळ: ${hours(minutes)}\n` +
      `आजच्या कामाचे पुष्टी केलेले बिल: ${money(bill)}\n` +
      `बिलाची पुष्टी बाकी: ${jobs.length - confirmed.length} काम\n` +
      `आज प्राप्त पेमेंट: ${money(received)}\n` +
      `एकूण शेतकरी बाकी: ${money(balance.due)}\n` +
      `एकूण आगाऊ जमा: ${money(balance.advance)}\n\n` +
      `कामाचा तपशील\n${workLines || 'आज पूर्ण कामाची नोंद नाही.'}\n\n` +
      `पेमेंट तपशील\n${paymentLines || 'आज पेमेंटची नोंद नाही.'}\n\n` +
      `ही माहिती server वर उपलब्ध नोंदींवर आधारित आहे.\n` +
      `Cutoff: ${cutoff}\n` +
      `Offline/उशीरा sync झालेल्या नोंदी यात नसू शकतात.\n\n` +
      `रिपोर्ट बंद करण्यासाठी: More → Email Report.\n\n` +
      `Tractor Hisab\nfarmtouchsupport@gmail.com`
  };
}

async function main() {
  const date = reportDate();
  if (new Date(date + 'T00:00:00+05:30') > new Date()) {
    throw new Error('Future report dates are not allowed');
  }

  const args = [];
  let where = 'daily_report_enabled=true and report_email is not null';
  if (env.REPORT_BUSINESS_ID) {
    args.push(env.REPORT_BUSINESS_ID);
    where += ' and id=$1';
  }

  const businesses = (await pool.query(
    `select id,name,owner_name,report_email
     from businesses where ${where} order by id`,
    args
  )).rows;

  let mail;
  if (!dryRun) {
    if (env.GMAIL_USER !== 'farmtouchsupport@gmail.com' ||
        !env.GMAIL_APP_PASSWORD) {
      throw new Error('Configure GMAIL_USER and GMAIL_APP_PASSWORD');
    }

    mail = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.GMAIL_USER,
        pass: env.GMAIL_APP_PASSWORD.replace(/\s/g, '')
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true
    });

    // Verify authentication before reserving any report.
    await mail.verify();
  }

  for (const b of businesses) {
    let reserved = false;
    let smtpAccepted = false;

    try {
      const payload = await tx(pool, async c => {
        await c.query('set transaction isolation level repeatable read');
        const report = await buildReport(c, b, date);

        if (dryRun) return report;

        const inserted = await c.query(
          `insert into daily_email_reports
             (business_id,report_date,recipient,payload,status)
           values ($1,$2,$3,$4,'sending')
           on conflict (business_id,report_date) do nothing
           returning business_id`,
          [b.id, date, b.report_email, JSON.stringify(report)]
        );

        if (!inserted.rowCount) return null;
        return report;
      });

      if (!payload) {
        console.log('Already attempted; skipped:', b.id, date);
        continue;
      }

      if (dryRun) {
        console.log('PREVIEW:', b.id, date, '\n' + payload.text);
        continue;
      }

      reserved = true;
      const info = await mail.sendMail({
        from: '"Tractor Hisab" <farmtouchsupport@gmail.com>',
        to: b.report_email,
        subject: payload.subject,
        text: payload.text,
        messageId: `<daily-${b.id}-${date}@tractorhisab.invalid>`
      });

      if (!info.accepted || !info.accepted.length) {
        throw Object.assign(new Error('Recipient rejected'), {
          code: 'EENVELOPE'
        });
      }
      smtpAccepted = true;

      await pool.query(
        `update daily_email_reports
         set status='accepted',message_id=$3,accepted_at=now()
         where business_id=$1 and report_date=$2`,
        [b.id, date, info.messageId]
      );

      console.log('SMTP accepted:', b.id, date);
    } catch (e) {
      process.exitCode = 1;
      const code = String(e.code || 'REPORT_ERROR').slice(0, 80);

      if (reserved) {
        const definitelyRejected = !smtpAccepted &&
          (code === 'EAUTH' || code === 'EENVELOPE' ||
           Number(e.responseCode) >= 500);

        await pool.query(
          `update daily_email_reports set status=$3,error_code=$4
           where business_id=$1 and report_date=$2`,
          [b.id, date, definitelyRejected ? 'failed' : 'unknown', code]
        ).catch(() => {});
      }

      console.error('Report needs review:', b.id, date, code);
    }
  }

  console.log('Eligible businesses:', businesses.length);
}

main()
  .catch(e => {
    console.error('Daily report failed:', e.code || e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());