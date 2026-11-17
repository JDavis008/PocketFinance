// Date + money helpers shared by the server.
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
const addMonths = (s, n) => {
  const d = parseISO(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last)); return isoDate(d);
};
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const monthOf = s => s.slice(0, 7);
const monthStart = m => `${m}-01`;
const monthEnd = m => { const [y, mo] = m.split('-').map(Number); return isoDate(new Date(y, mo, 0)); };
const prevMonth = m => addMonths(`${m}-01`, -1).slice(0, 7);
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

module.exports = { isoDate, today, parseISO, addDays, addMonths, daysBetween, monthOf, monthStart, monthEnd, prevMonth, round2, median };
