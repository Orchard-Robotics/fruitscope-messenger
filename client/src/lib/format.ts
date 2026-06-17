import { format, isToday, isYesterday } from "date-fns";

export const timeOfDay = (ts: number): string => format(ts, "h:mm a");

export const dayLabel = (ts: number): string => {
  if (isToday(ts)) return "Today";
  if (isYesterday(ts)) return "Yesterday";
  return format(ts, "EEEE, MMMM d");
};

export const fullStamp = (ts: number): string => format(ts, "EEE, MMM d 'at' h:mm a");

/** True when two timestamps fall on different calendar days. */
export const isNewDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() !== new Date(b).toDateString();
