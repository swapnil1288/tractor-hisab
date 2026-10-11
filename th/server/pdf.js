const { formatPaise } = require('./billing');
let browserP = null;

function chromiumPath() { return process.env.CHROMIUM_PATH || '/usr/bin/chromium'; }
async function browser() {
  if (!browserP) {
    const { chromium } = require('playwright-core');
    browserP = chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .catch(e => { browserP = null; throw e; });
  }
  return browserP;
}
async function close() { if (browserP) { const b = await browserP.catch(() => null); browserP = null; if (b) await b.close(); } }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = {
  mr: { title: 'ट्रॅक्टर कामाचा हिशोब', farmer: 'शेतकरी', village: 'गाव', mobile: 'मोबाईल', period: 'कालावधी', all: 'सुरुवातीपासून', date: 'तारीख', detail: 'तपशील', bill: 'बिल', paid: 'जमा', bal: 'शिल्लक',
    opening: 'मागील शिल्लक', billed: 'एकूण बिल', received: 'एकूण जमा', due: 'येणे बाकी', adv: 'आगाऊ जमा', clear: 'हिशोब पूर्ण', owner: 'मालक', made: 'तयार केले', page: 'पान', reprint: 'पुनर्मुद्रण', sign: 'सही', none: 'या कालावधीत नोंदी नाहीत', thanks: 'कृपया बाकी रक्कम लवकर जमा करावी. धन्यवाद!', no: 'क्र.' },
  hi: { title: 'ट्रैक्टर काम का हिसाब', farmer: 'किसान', village: 'गाँव', mobile: 'मोबाइल', period: 'अवधि', all: 'शुरुआत से', date: 'तारीख', detail: 'विवरण', bill: 'बिल', paid: 'जमा', bal: 'शेष',
    opening: 'पिछला शेष', billed: 'कुल बिल', received: 'कुल जमा', due: 'बकाया', adv: 'अग्रिम जमा', clear: 'हिसाब पूरा', owner: 'मालिक', made: 'बनाया', page: 'पेज', reprint: 'पुनर्मुद्रण', sign: 'हस्ताक्षर', none: 'इस अवधि में कोई प्रविष्टि नहीं', thanks: 'कृपया बकाया राशि जल्द जमा करें। धन्यवाद!', no: 'क्र.' }
};
const dmy = d => d ? d.split('-').reverse().join('-') : '';

function statementHTML(s, opts) {
  const l = L[(opts && opts.lang) || 'mr'] || L.mr;
  const st = s.closing > 0 ? [l.due, '#C0362C'] : s.closing < 0 ? [l.adv, '#1D5BBF'] : [l.clear, '#1F7A45'];
  const rows = s.rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td>${dmy(r.date)}</td><td><b>${esc(r.detail)}</b>${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ''}</td>
    <td class="m">${r.debit ? formatPaise(r.debit) : ''}</td><td class="m cr">${r.credit ? formatPaise(r.credit) : ''}</td><td class="m b">${formatPaise(r.balance)}</td></tr>`).join('');
  return `<!doctype html><html lang="mr"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:14mm 12mm 16mm}
  *{box-sizing:border-box} body{font-family:"Noto Sans Devanagari","Mukta","Nirmala UI",sans-serif;color:#17221C;font-size:11pt;margin:0}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1F6F43;padding-bottom:8px}
  h1{font-size:20pt;margin:0;color:#1F6F43} .own{text-align:right;font-size:10.5pt}
  .meta{display:flex;justify-content:space-between;margin:10px 0;font-size:10.5pt} .meta b{font-size:13pt}
  .sum{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 12px}
  .box{background:#F2F5F2;border-radius:6px;padding:7px 10px} .box small{display:block;color:#56655C;font-size:9pt} .box b{font-size:13pt}
  .box.last{background:#FBF6E6;border-left:5px solid ${st[1]}} .box.last b{color:${st[1]}}
  table{width:100%;border-collapse:collapse;font-size:10pt} thead th{background:#1F6F43;color:#fff;text-align:left;padding:6px 6px;font-weight:600}
  td{padding:6px 6px;border-bottom:1px solid #DDE3DE;vertical-align:top} tr:nth-child(even) td{background:#FAFBFA}
  .m{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} .cr{color:#1D5BBF} .b{font-weight:700} .n{color:#87958C;width:26px}
  .sub{color:#56655C;font-size:9pt} .open td{background:#F2F5F2!important;font-weight:600}
  .foot{margin-top:18px;display:flex;justify-content:space-between;align-items:flex-end;font-size:10pt;color:#56655C}
  .sign{border-top:1px solid #9AA59E;padding-top:4px;width:180px;text-align:center}
  .tag{display:inline-block;font-size:9pt;background:#FBF6E6;border-radius:4px;padding:1px 6px;margin-left:6px}
  </style></head><body>
  <div class="top"><div><h1>${l.title}</h1><div>${esc(s.business.name)}</div></div>
   <div class="own"><b>${l.owner}: ${esc(s.business.owner_name)}</b><br>${esc([s.business.village, s.business.mobile].filter(Boolean).join(' · '))}${s.business.upi ? `<br>UPI: ${esc(s.business.upi)}` : ''}</div></div>
  <div class="meta"><div><b>${l.farmer}: ${esc(s.farmer.name)}</b><br>${[s.farmer.village ? `${l.village}: ${esc(s.farmer.village)}` : '', s.farmer.mobile ? `${l.mobile}: ${esc(s.farmer.mobile)}` : ''].filter(Boolean).join(' &nbsp; ')}</div>
   <div style="text-align:right">${l.period}: ${s.from ? dmy(s.from) : l.all} – ${dmy(s.to)}<br>${l.made}: ${esc(s.generatedAtText)}${opts && opts.reprint ? `<span class="tag">${l.reprint}</span>` : ''}${s.number ? `<br>${l.no} ${esc(s.number)}` : ''}</div></div>
  <div class="sum"><div class="box"><small>${l.opening}</small><b>${formatPaise(s.opening)}</b></div><div class="box"><small>${l.billed}</small><b>${formatPaise(s.totals.debit)}</b></div>
   <div class="box"><small>${l.received}</small><b style="color:#1D5BBF">${formatPaise(s.totals.credit)}</b></div><div class="box last"><small>${st[0]}</small><b>${formatPaise(Math.abs(s.closing))}</b></div></div>
  <table><thead><tr><th></th><th>${l.date}</th><th>${l.detail}</th><th class="m">${l.bill}</th><th class="m">${l.paid}</th><th class="m">${l.bal}</th></tr></thead><tbody>
   <tr class="open"><td></td><td>${s.from ? dmy(s.from) : ''}</td><td>${l.opening}</td><td></td><td></td><td class="m">${formatPaise(s.opening)}</td></tr>
   ${rows || `<tr><td colspan="6" style="text-align:center;color:#87958C">${l.none}</td></tr>`}</tbody></table>
  <div class="foot"><div>${s.closing > 0 ? l.thanks : ''}</div><div class="sign">${l.sign}</div></div>
  </body></html>`;
}

async function renderPDF(html) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    return await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#87958C;font-family:Noto Sans Devanagari,sans-serif">ट्रॅक्टर हिशोब · <span class="pageNumber"></span>/<span class="totalPages"></span></div>', margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' } });
  } finally { await page.close(); }
}

module.exports = { statementHTML, renderPDF, close };
