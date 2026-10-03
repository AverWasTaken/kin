const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const longDateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

export const DAY = 86_400_000;

export function clock(ts: number) {
  return timeFmt.format(ts);
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** iMessage-style separator: "Today 9:41 AM", "Yesterday 8:02 PM", "Tuesday 3:12 PM", "Mon, Sep 28 at 4:00 PM". */
export function separator(ts: number) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY);
  if (days === 0) return { day: "Today", time: clock(ts) };
  if (days === 1) return { day: "Yesterday", time: clock(ts) };
  if (days < 7) return { day: weekdayFmt.format(ts), time: clock(ts) };
  return { day: shortDateFmt.format(ts), time: clock(ts) };
}

export function longDate(ts: number) {
  return longDateFmt.format(ts);
}

export function shortDate(ts: number) {
  return shortDateFmt.format(ts);
}

/** "in 2h", "in 3 days", "5m ago". */
export function relative(ts: number, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  let text: string;
  if (abs < 60_000) return diff >= 0 ? "now" : "just now";
  if (abs < 3_600_000) text = `${Math.round(abs / 60_000)}m`;
  else if (abs < DAY) text = `${Math.round(abs / 3_600_000)}h`;
  else {
    const d = Math.round(abs / DAY);
    text = `${d} day${d === 1 ? "" : "s"}`;
  }
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/** Friendly time for an upcoming moment: "Today 7:00 AM", "Tomorrow 9:00 AM", "Thu 6:30 PM". */
export function upcoming(ts: number) {
  const days = Math.round((startOfDay(ts) - startOfDay(Date.now())) / DAY);
  if (days === 0) return `Today ${clock(ts)}`;
  if (days === 1) return `Tomorrow ${clock(ts)}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(ts)} ${clock(ts)}`;
  return `${shortDateFmt.format(ts)} ${clock(ts)}`;
}

export function compactNumber(n: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
