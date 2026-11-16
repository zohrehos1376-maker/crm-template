// آمار کار کارشناسان، روزبه‌روز (روز به وقت تهران) — بدون نمره و رتبه، فقط شمارش کارهای انجام‌شده.
// ورودی‌ها ردیف‌های خام‌اند (modules/crm/services/repStatsService.js می‌سازد)؛ این‌جا فقط جمع زده می‌شود.
const { startOfTodayTehran } = require('./consultant-desk');

const UNANSWERED = ['MISSED', 'REJECTED'];
const REP_KEYS = ['calls', 'incoming', 'outgoing', 'talkSec', 'priceInquiry', 'objection', 'outOfStock', 'order', 'callbacks', 'followups', 'named', 'kycApproved', 'kycRejected', 'kycWaitMs'];
const TEAM_KEYS = REP_KEYS.concat(['missed', 'missedOpen', 'unlogged']);

const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
const add = (a, b, keys) => { for (const k of keys) a[k] += b[k] || 0; return a; };

// calls: { userId, at, direction, durationSec, logStatus, outcomes[], callbackDone }
// followups / named: { userId, at } — kyc: { userId, at, approved, waitMs }
function build({ calls = [], followups = [], named = [], kyc = [] }) {
  const days = new Map();
  const dayOf = (at) => {
    const key = startOfTodayTehran(at);
    if (!days.has(key)) days.set(key, { day: key, team: zero(TEAM_KEYS), reps: new Map() });
    return days.get(key);
  };
  const rep = (d, userId) => {
    if (!d.reps.has(userId)) d.reps.set(userId, zero(REP_KEYS));
    return d.reps.get(userId);
  };

  for (const c of calls) {
    const d = dayOf(c.at);
    const missed = UNANSWERED.includes(c.direction);
    if (missed) {
      d.team.missed++;
      if (!c.callbackDone) d.team.missedOpen++;
      // بی‌پاسخی که کارشناس به آن زنگ برگشته (پاسخ‌دهنده روی همان بی‌پاسخ ثبت می‌شود)
      if (c.callbackDone && c.userId) rep(d, c.userId).callbacks++;
      continue; // نتیجه‌ی تماس برگشتی روی بی‌پاسخ‌ها کپی می‌شود؛ دوباره شمرده نشود
    }
    if (c.logStatus !== 'LOGGED' || !c.userId) {
      if (c.durationSec > 0 && c.logStatus === 'UNLOGGED') d.team.unlogged++;
      continue;
    }
    const r = rep(d, c.userId);
    r.calls++;
    if (c.direction === 'INCOMING') r.incoming++;
    else r.outgoing++;
    r.talkSec += c.durationSec || 0;
    const o = c.outcomes || [];
    if (o.includes('price_inquiry')) r.priceInquiry++;
    if (o.includes('price_objection')) r.objection++;
    if (o.includes('out_of_stock')) r.outOfStock++;
    if (o.includes('order')) r.order++;
  }
  for (const f of followups) if (f.userId) rep(dayOf(f.at), f.userId).followups++;
  for (const n of named) if (n.userId) rep(dayOf(n.at), n.userId).named++;
  for (const k of kyc) {
    if (!k.userId) continue;
    const r = rep(dayOf(k.at), k.userId);
    if (k.approved) {
      r.kycApproved++;
      r.kycWaitMs += k.waitMs || 0;
    } else r.kycRejected++;
  }

  const out = [...days.values()].sort((a, b) => b.day - a.day).map((d) => {
    const reps = [...d.reps.entries()].map(([userId, v]) => Object.assign({ userId }, v));
    for (const r of reps) add(d.team, r, REP_KEYS);
    return { day: d.day, team: d.team, reps };
  });
  // جمع کل بازه، هم برای هر کارشناس هم برای تیم
  const total = zero(TEAM_KEYS);
  const byRep = new Map();
  for (const d of out) {
    add(total, d.team, TEAM_KEYS);
    for (const r of d.reps) {
      if (!byRep.has(r.userId)) byRep.set(r.userId, Object.assign({ userId: r.userId, activeDays: 0 }, zero(REP_KEYS)));
      const t = byRep.get(r.userId);
      add(t, r, REP_KEYS);
      t.activeDays++;
    }
  }
  return { days: out, total, reps: [...byRep.values()] };
}

module.exports = { build, REP_KEYS, TEAM_KEYS };
