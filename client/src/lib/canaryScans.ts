import type { CanaryScan } from "@/lib/canary";

/**
 * A selectable scan group — one scan, or several "combined" scans analyzed
 * together (FruitScope groups same-day scans of the same stage + entity type).
 */
export interface ScanGroup {
  scanIds: number[];
  scanNames: string[];
  /** Latest scan time in the group. */
  time: string;
  stage: string | null;
  variety: string | null;
  entityType: string | null;
  /** Summed across the group. */
  rows: number | null;
  trees: number | null;
}

const single = (s: CanaryScan): ScanGroup => ({
  scanIds: [s.scanId],
  scanNames: [s.scanName],
  time: s.time,
  stage: s.stage,
  variety: s.variety,
  entityType: s.entityType,
  rows: s.rows,
  trees: s.trees,
});

/** Calendar day of an ISO timestamp (date part — good enough without the tz). */
const dayKey = (iso: string): string => iso.slice(0, 10);

/**
 * Group a block's scans for display. With `combine` off, one group per scan.
 * With it on, scans sharing a calendar day + stage + entity type merge into a
 * single group (ids latest-first; rows/trees summed) — mirroring FruitScope's
 * default combine rule (admin override sets aside).
 */
export function groupScans(scans: CanaryScan[], combine: boolean): ScanGroup[] {
  if (!combine) return scans.map(single);

  const order: string[] = [];
  const byKey = new Map<string, CanaryScan[]>();
  for (const s of scans) {
    const k = `${dayKey(s.time)}|${s.entityType ?? ""}|${s.stage ?? ""}`;
    if (!byKey.has(k)) {
      byKey.set(k, []);
      order.push(k);
    }
    byKey.get(k)?.push(s);
  }

  return order.map((k) => {
    const g = byKey.get(k) as CanaryScan[]; // newest-first (input is newest-first)
    if (g.length === 1) return single(g[0] as CanaryScan);
    const sum = (pick: (s: CanaryScan) => number | null): number | null => {
      const total = g.reduce((acc, s) => acc + (pick(s) ?? 0), 0);
      return total || null;
    };
    const head = g[0] as CanaryScan;
    return {
      scanIds: g.map((s) => s.scanId),
      scanNames: g.map((s) => s.scanName),
      time: head.time,
      stage: head.stage,
      variety: head.variety,
      entityType: head.entityType,
      rows: sum((s) => s.rows),
      trees: sum((s) => s.trees),
    };
  });
}

/** A short label for a selected scan group (for the chat `current_view`). */
export function scanLabel(group: ScanGroup): string {
  return group.scanNames.join(" / ");
}
