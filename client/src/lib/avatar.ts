/** First letters of the first two words, e.g. "Willow Vale" -> "WV". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || name.slice(0, 2).toUpperCase();
}

/** A stable two-stop gradient derived from a user's hue. */
export function avatarGradient(hue: number): string {
  return `linear-gradient(140deg, hsl(${hue} 70% 58%), hsl(${(hue + 42) % 360} 62% 42%))`;
}
