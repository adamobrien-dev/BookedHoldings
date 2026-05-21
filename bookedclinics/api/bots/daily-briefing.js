const BASE  = 'https://www.bookedclinics.ca';
const TGRAM = 'https://api.telegram.org/bot';
const CHAT  = process.env.TELEGRAM_CHAT_ID;

const BOTS = {
  jordan: process.env.TELEGRAM_JORDAN_TOKEN,
  morgan: process.env.TELEGRAM_MORGAN_TOKEN,
  alex:   process.env.TELEGRAM_ALEX_TOKEN,
  riley:  process.env.TELEGRAM_RILEY_TOKEN,
  casey:  process.env.TELEGRAM_CASEY_TOKEN,
};

async function send(bot, text) {
  const token = BOTS[bot];
  if (!token || !CHAT) return;
  const r = await fetch(`${TGRAM}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML' }),
  });
  const d = await r.json();
  if (!d.ok) console.error(`${bot} send failed:`, d.description);
}

function fmt$(n) { return n != null ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function today() { return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }

// ── JORDAN — Morning Operations Briefing ────────────────────────────────────
function buildJordan(dash, meta) {
  const s = dash.summary;
  const ap = s.agencyPipeline || {};
  const now = new Date();
  const lines = [`🌅 <b>Morning, Adam — Jordan here.</b>`, `<i>${today()}</i>`, ``];

  // Red alerts
  const urgent = [];
  (s.billingRows || []).filter(r => r.paymentStatus === 'failed').forEach(r => {
    urgent.push(`🔴 <b>${r.name}</b> — $${r.retainerAmount || 500} payment FAILED on Stripe`);
  });
  (s.billingRows || []).filter(r => r.nextDueDate && r.paymentStatus !== 'failed').forEach(r => {
    const days = Math.ceil((new Date(r.nextDueDate) - now) / 86400000);
    if (days < 0) urgent.push(`🔴 <b>${r.name}</b> — invoice ${Math.abs(days)}d overdue`);
  });
  const scR = s.scRecovery;
  if (scR?.needsRecovery?.length > 0) {
    urgent.push(`🔴 <b>${scR.needsRecovery.length} SC contacts</b> with no call booked — ${scR.needsRecovery.map(c => c.name).join(', ')}`);
  }
  (meta.accounts || []).filter(a => a.isUnsettled || a.isDisabled).forEach(a => {
    urgent.push(`🔴 <b>${a.name}</b> — Meta account ${a.isDisabled ? 'DISABLED' : 'UNSETTLED'}`);
  });

  if (urgent.length > 0) {
    lines.push(`<b>DO NOW</b>`);
    urgent.forEach(u => lines.push(u));
    lines.push(``);
  }

  // Pipeline
  lines.push(`<b>📈 Pipeline</b>`);
  lines.push(`• SC Upcoming: <b>${ap.scUpcoming ?? '—'}</b> 🔥 ${(ap.scNames || []).join(', ')}`);
  lines.push(`• DC Upcoming: <b>${ap.dcUpcoming ?? '—'}</b>`);
  lines.push(`• No-Shows to Recover: <b>${ap.dcNoShow ?? '—'}</b>${ap.dcNoShowNames?.length ? ' — ' + ap.dcNoShowNames.join(', ') : ''}`);
  lines.push(``);

  // Billing
  const mrrTotal = (s.billingRows || []).filter(r => r.paymentStatus !== 'failed' && r.retainerAmount).reduce((s2, r) => s2 + r.retainerAmount, 0);
  lines.push(`<b>💳 Billing</b>`);
  lines.push(`• MRR: <b>${fmt$(mrrTotal)}/mo</b> | Collected: <b>${fmt$(s.totalCollected)}</b>`);
  const upcoming = (s.billingRows || []).filter(r => r.nextDueDate && r.paymentStatus !== 'failed').map(r => {
    const days = Math.ceil((new Date(r.nextDueDate) - now) / 86400000);
    if (days >= 0 && days <= 7) return `${r.name} in ${days}d`;
    return null;
  }).filter(Boolean);
  if (upcoming.length) lines.push(`• Due soon: ${upcoming.join(' · ')}`);
  lines.push(``);

  // Meta
  lines.push(`<b>📣 Meta Ads (7d)</b>`);
  (meta.accounts || []).forEach(a => {
    const status = a.isDisabled ? '🔴 DISABLED' : a.isUnsettled ? '⚠️ UNSETTLED' : '🟢';
    const perf = a.spend != null ? `${fmt$(a.spend)} · ${a.leads ?? 0} leads${a.cpl ? ' · $' + a.cpl.toFixed(0) + ' CPL' : ''}` : 'no data';
    lines.push(`• ${a.name.split('—')[0].trim()}: ${status} ${perf}`);
  });

  lines.push(``);
  lines.push(`Have a great day. 💪`);
  return lines.join('\n');
}

// ── MORGAN — Billing Update ──────────────────────────────────────────────────
function buildMorgan(dash) {
  const s = dash.summary;
  const now = new Date();
  const lines = [`💳 <b>Morgan — Billing Check</b>`, ``];

  (s.billingRows || []).forEach(r => {
    let icon, note;
    if (r.paymentStatus === 'failed') {
      icon = '❌'; note = `<b>FAILED</b> — resend payment link now`;
    } else if (r.nextDueDate) {
      const days = Math.ceil((new Date(r.nextDueDate) - now) / 86400000);
      if (days < 0)      { icon = '🔴'; note = `<b>${Math.abs(days)}d overdue</b> — invoice immediately`; }
      else if (days <= 3){ icon = '⚠️'; note = `due in <b>${days}d</b> (${fmtDate(r.nextDueDate)})`; }
      else if (days <= 7){ icon = '📅'; note = `due ${fmtDate(r.nextDueDate)} in ${days}d`; }
      else               { icon = '✅'; note = `next due ${fmtDate(r.nextDueDate)}`; }
    } else {
      icon = r.lastPaidDate ? '✅' : '❓';
      note = r.lastPaidDate ? `last paid ${fmtDate(r.lastPaidDate)}` : 'no payment on record';
    }
    const installStr = r.installmentPaid && r.installmentTotal ? ` · installment ${r.installmentPaid}/${r.installmentTotal}` : '';
    lines.push(`${icon} <b>${r.name}</b>${installStr} — ${note}`);
  });

  lines.push(``);
  lines.push(`Stripe balance: <b>${fmt$(Math.round((dash.summary.stripeBalanceCents || 0) / 100))}</b>`);
  return lines.join('\n');
}

// ── ALEX — Meta Ads Update ───────────────────────────────────────────────────
function buildAlex(meta) {
  const lines = [`📣 <b>Alex — Meta Ads (Last 7 Days)</b>`, ``];

  (meta.accounts || []).forEach(a => {
    if (a.isDisabled) {
      lines.push(`🔴 <b>${a.name}</b>`);
      lines.push(`   Account DISABLED — campaigns not running`);
    } else if (a.isUnsettled) {
      lines.push(`⚠️ <b>${a.name}</b>`);
      lines.push(`   Account UNSETTLED — billing failed, ads may pause`);
    } else if (a.error) {
      lines.push(`❓ <b>${a.name}</b> — API error`);
    } else {
      const cplColor = a.cpl == null ? '' : a.cpl > 75 ? ' 🔴' : a.cpl > 40 ? ' 🟡' : ' 🟢';
      const leadsFlag = a.spend > 50 && (a.leads === 0 || a.leads == null) ? ' ⚠️ 0 leads!' : '';
      lines.push(`🟢 <b>${a.name}</b>`);
      lines.push(`   Spend: <b>${fmt$(a.spend)}</b> · Leads: <b>${a.leads ?? 0}</b>${leadsFlag} · CPL: <b>${a.cpl ? '$' + a.cpl.toFixed(0) : '—'}</b>${cplColor}`);
    }
  });

  return lines.join('\n');
}

// ── RILEY — Agency Sales Pipeline ───────────────────────────────────────────
function buildRiley(dash, rec) {
  const ap = dash.summary.agencyPipeline || {};
  const lines = [`📈 <b>Riley — Agency Pipeline</b>`, ``];

  if (ap.scUpcoming > 0) {
    lines.push(`🔥 <b>SC Upcoming — ${ap.scUpcoming} hot prospect${ap.scUpcoming > 1 ? 's' : ''}</b>`);
    (ap.scNames || []).forEach(n => lines.push(`   • ${n}`));
    lines.push(``);
  }

  lines.push(`📅 DC Upcoming: <b>${ap.dcUpcoming ?? 0}</b> first calls booked`);

  if ((ap.dcNoShow ?? 0) > 0) {
    lines.push(`⚠️ No-Shows to recover: <b>${ap.dcNoShow}</b>`);
    (ap.dcNoShowNames || []).forEach(n => lines.push(`   • ${n}`));
  }

  lines.push(``);
  lines.push(`Won: <b>${ap.won ?? 0}</b> clients · Lost: <b>${ap.lost ?? 0}</b> · Total in pipeline: <b>${ap.total ?? 0}</b>`);

  // Recovery data
  if (rec) {
    const s = rec.summary || {};
    lines.push(``);
    lines.push(`<b>🚨 Recovery Queue</b>`);
    if (s.scNoCall > 0) {
      lines.push(`• SC no call booked: <b>${s.scNoCall}</b> — ${rec.scNoCall.map(c => c.name).join(', ')}`);
    }
    if (s.dcNoShows > 0) {
      lines.push(`• DC no-shows: <b>${s.dcNoShows}</b> — ${rec.dcNoShows.map(c => c.name).join(', ')}`);
    }
    if (s.staleContracts > 0) {
      const critical = s.criticalContracts > 0 ? ` (${s.criticalContracts} critical >14d)` : '';
      lines.push(`• Unsigned contracts: <b>${s.staleContracts}</b>${critical}`);
    }
    if (s.totalRecoverable === 0) {
      lines.push(`• All clear — nothing in the recovery queue`);
    }
  }

  return lines.join('\n');
}

// ── CASEY — Client Health ────────────────────────────────────────────────────
function buildCasey(dash) {
  const WF_KEYS = ['fast5','confirmation','noshow','review','nurture','stale'];
  const lines = [`👥 <b>Casey — Client Health</b>`, ``];
  let totalDraft = 0;

  (dash.clients || []).filter(c => ['terri','allaphia','thania','aguilera'].includes(c.key)).forEach(c => {
    const l = c.leads || {};
    const pct = l.total > 0 ? Math.round((l.new / l.total) * 100) : 0;
    const stuckFlag = pct > 70 ? ` ⚠️ ${pct}% stuck` : '';
    const liveWf = WF_KEYS.filter(w => (c.workflows || {})[w] === 'LIVE').length;
    const draftWf = WF_KEYS.filter(w => (c.workflows || {})[w] === 'DRAFT').length;
    totalDraft += draftWf;
    const wfFlag = liveWf === 0 ? ` 🔴 0 wf live` : ` · ${liveWf}/6 wf`;

    lines.push(`<b>${c.name || c.key}</b>${wfFlag}${stuckFlag}`);
    lines.push(`   ${l.total ?? 0} leads · ${l.booked ?? 0} booked · ${l.sale ?? 0} sales`);
  });

  if (totalDraft > 0) {
    lines.push(``);
    lines.push(`⚠️ <b>${totalDraft} workflows still in draft</b> — leads entering with zero follow-up`);
  }

  return lines.join('\n');
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  res.setHeader('Cache-Control', 'no-store');

  try {
    const [dashRes, metaRes, recRes] = await Promise.all([
      fetch(`${BASE}/api/dashboard-data`),
      fetch(`${BASE}/api/meta-ads`),
      fetch(`${BASE}/api/recovery`),
    ]);

    const dash = await dashRes.json();
    const meta = await metaRes.json();
    const rec  = recRes.ok ? await recRes.json() : null;

    await Promise.all([
      send('jordan', buildJordan(dash, meta)),
      send('morgan', buildMorgan(dash)),
      send('alex',   buildAlex(meta)),
      send('riley',  buildRiley(dash, rec)),
      send('casey',  buildCasey(dash)),
    ]);

    res.status(200).json({ ok: true, sent: Object.keys(BOTS), at: new Date().toISOString() });
  } catch (err) {
    console.error('daily-briefing error:', err);
    res.status(500).json({ error: err.message });
  }
};
