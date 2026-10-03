const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** Best-effort English for simple "m h * * dow" crons. Falls back to the raw expression. */
export function cronHuman(cron: string | null): string {
  if (!cron) return "No check-ins";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, dom, mon, dow] = parts;
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h) || dom !== "*" || mon !== "*") return cron;
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  if (dow === "*") return `Every day at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  const days = dow.split(",").map((x) => DAYS[Number(x) % 7]);
  if (days.some((x) => !x)) return cron;
  const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
  return `${list} at ${time}`;
}
