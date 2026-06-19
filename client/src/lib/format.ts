// Date formatting via the built-in Intl API — zero bundle cost (no date-fns).

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Days between two timestamps by *local* calendar date (DST-safe). */
function calendarDayDiff(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const midnightA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const midnightB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((midnightB - midnightA) / 86400000);
}

export const timeOfDay = (ts: number): string => timeFmt.format(ts);

export const dayLabel = (ts: number): string => {
  const diff = calendarDayDiff(ts, Date.now());
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dayFmt.format(ts);
};

export const fullStamp = (ts: number): string => fullFmt.format(ts);

/** True when two timestamps fall on different calendar days. */
export const isNewDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() !== new Date(b).toDateString();
