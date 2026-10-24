// Pure deadline calculation. Supply one immutable holiday set per request;
// offsets retain the existing calendar-day then weekend/holiday adjustment rule.
const pad = n => String(n).padStart(2, '0');
function addDays(value, days) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function dateMath(holidays) {
  function businessDay(value, direction) {
    let day = value;
    for (let n = 0; n < 40; n++) {
      const [year, month, date] = day.split('-').map(Number);
      const weekday = new Date(year, month - 1, date).getDay();
      if (weekday !== 0 && weekday !== 6 && !holidays.has(day)) return day;
      day = addDays(day, direction < 0 ? -1 : 1);
    }
    return day;
  }
  function dueFrom(from, days, matter) {
    const base = from === 'opened' ? (matter.created_at || '').slice(0, 10) : from === 'finance' ? matter.finance_date : from === 'settlement' ? matter.settlement_date : null;
    if (!base) return null;
    return days ? businessDay(addDays(base, days), days < 0 ? -1 : 1) : base;
  }
  return { businessDay, dueFrom, stageDue: (stage, matter) => dueFrom(stage.from, stage.days, matter) };
}
module.exports = { dateMath };
