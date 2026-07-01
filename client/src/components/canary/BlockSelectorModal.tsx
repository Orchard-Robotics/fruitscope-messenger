import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, Check, Layers, Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type CanaryBlock, type CanaryScan, canaryApi } from "@/lib/canary";
import { type ScanGroup, groupScans, scanLabel } from "@/lib/canaryScans";
import { cn } from "@/lib/cn";
import { mapboxSatelliteStyle } from "@/lib/mapbox";

const CIRCLES = "blocks-circles";

/** Add (or refresh) block boundary polygons — a translucent fill + white outline,
 *  inserted below the marker circles so those stay on top. Idempotent. */
function addBoundaryLayers(
  map: maplibregl.Map,
  fc: GeoJSON.FeatureCollection,
  selectedBlockId: number | null,
): void {
  const existing = map.getSource("block-shapes") as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
    if (map.getLayer("block-fill-selected")) {
      map.setFilter("block-fill-selected", ["==", ["get", "block_id"], selectedBlockId ?? -1]);
    }
    return;
  }
  const below = map.getLayer(CIRCLES) ? CIRCLES : undefined;
  map.addSource("block-shapes", { type: "geojson", data: fc });
  map.addLayer(
    { id: "block-fill", type: "fill", source: "block-shapes", paint: { "fill-color": "#3f8a66", "fill-opacity": 0.12 } },
    below,
  );
  map.addLayer(
    {
      id: "block-fill-selected",
      type: "fill",
      source: "block-shapes",
      filter: ["==", ["get", "block_id"], selectedBlockId ?? -1],
      paint: { "fill-color": "#3f8a66", "fill-opacity": 0.35 },
    },
    below,
  );
  map.addLayer(
    {
      id: "block-outline",
      type: "line",
      source: "block-shapes",
      paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.8 },
    },
    below,
  );
}

/** The result of the picker: a block (+ optional scan group), or "all blocks". */
export interface BlockSelection {
  blockId: number | null;
  blockName: string | null;
  scanIds: number[] | null;
  scanLabel: string | null;
}

const scanTime = (b: CanaryBlock): number => (b.lastScanDate ? Date.parse(b.lastScanDate) || 0 : 0);

function fmtAgo(iso: string | null): string {
  if (!iso) return "No scans yet";
  const t = Date.parse(iso);
  if (!t) return "No scans yet";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtScanWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!t) return iso;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * FruitScope-style block + scan picker: a recency-ordered list paired with a
 * MapLibre satellite map, then a per-block scan timeline (with a "combine scans"
 * toggle that merges same-day scans).
 */
export function BlockSelectorModal({
  blocks,
  orchard,
  selectedBlockId,
  onSelect,
  onClose,
}: {
  blocks: CanaryBlock[];
  orchard: string;
  selectedBlockId: number | null;
  onSelect: (sel: BlockSelection) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [drill, setDrill] = useState<CanaryBlock | null>(null);
  const [scans, setScans] = useState<CanaryScan[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [scansError, setScansError] = useState<string | null>(null);
  const [combine, setCombine] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const drillRef = useRef<(b: CanaryBlock) => void>(() => {});
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundariesRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const [boundaries, setBoundaries] = useState<GeoJSON.FeatureCollection | null>(null);

  const blockById = useMemo(() => new Map(blocks.map((b) => [b.blockId, b])), [blocks]);
  const ordered = useMemo(() => [...blocks].sort((a, b) => scanTime(b) - scanTime(a)), [blocks]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (b) => b.blockName.toLowerCase().includes(q) || b.ranchName?.toLowerCase().includes(q),
    );
  }, [ordered, query]);
  const located = useMemo(() => blocks.filter((b) => b.lat != null && b.lon != null), [blocks]);

  const drillInto = (block: CanaryBlock) => {
    setDrill(block);
    setScans([]);
    setScansError(null);
    setScansLoading(true);
    setCombine(false);
    canaryApi
      .scans(orchard, block.blockName)
      .then(setScans)
      .catch((e) => setScansError(e instanceof Error ? e.message : "Couldn't load scans."))
      .finally(() => setScansLoading(false));
  };
  drillRef.current = drillInto;

  // Fetch the block boundary polygons for the map outlines.
  useEffect(() => {
    let live = true;
    canaryApi
      .blockGeojson(orchard)
      .then((fc) => live && setBoundaries(fc))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orchard]);

  // Draw the outlines once they've loaded (the map is created once, so this adds
  // them to the existing map; the load handler covers the arrived-before-load case).
  useEffect(() => {
    boundariesRef.current = boundaries;
    const map = mapRef.current;
    if (map && boundaries && map.isStyleLoaded()) addBoundaryLayers(map, boundaries, selectedBlockId);
  }, [boundaries, selectedBlockId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (drill ? setDrill(null) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, drill]);

  /* ----- the map (created once) ----- */
  useEffect(() => {
    if (!mapContainer.current) return;
    const times = located.map(scanTime).filter((t) => t > 0);
    const min = times.length ? Math.min(...times) : 0;
    const max = times.length ? Math.max(...times) : 1;
    const recency = (b: CanaryBlock): number => {
      const t = scanTime(b);
      if (!t || max === min) return t ? 1 : 0;
      return (t - min) / (max - min);
    };
    const features = located.map((b) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [b.lon as number, b.lat as number] },
      properties: { blockId: b.blockId, name: b.blockName, recency: recency(b) },
    }));

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: mapboxSatelliteStyle(),
      center: features[0] ? (features[0].geometry.coordinates as [number, number]) : [-119.7, 36.7],
      zoom: 9,
      attributionControl: false,
    });
    mapRef.current = map;
    // Top-left so the zoom buttons don't sit under the modal's top-right X.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    map.on("load", () => {
      map.resize();
      // Open zoomed in on the most-recently-scanned block; fall back to fitting
      // all of them when none have a scan.
      const latest = [...located].filter((b) => scanTime(b) > 0).sort((a, b) => scanTime(b) - scanTime(a))[0];
      if (latest && latest.lat != null && latest.lon != null) {
        map.jumpTo({ center: [latest.lon, latest.lat], zoom: 14.5 });
      } else if (features.length) {
        const bnds = new maplibregl.LngLatBounds();
        for (const f of features) bnds.extend(f.geometry.coordinates as [number, number]);
        map.fitBounds(bnds, { padding: 60, maxZoom: 15, duration: 0 });
      }
      map.addSource("blocks", { type: "geojson", data: { type: "FeatureCollection", features } });
      map.addLayer({
        id: CIRCLES,
        type: "circle",
        source: "blocks",
        paint: {
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-color": ["interpolate", ["linear"], ["get", "recency"], 0, "#9ca3af", 0.5, "#eab308", 1, "#22c55e"],
        },
      });
      map.addLayer({
        id: "blocks-selected",
        type: "circle",
        source: "blocks",
        filter: ["==", ["get", "blockId"], selectedBlockId ?? -1],
        paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#3f8a66", "circle-stroke-width": 3 },
      });
      map.addLayer({
        id: "blocks-labels",
        type: "symbol",
        source: "blocks",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Bold"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.4 },
      });
      // Block boundary outlines, if they've loaded (below the marker circles).
      if (boundariesRef.current) addBoundaryLayers(map, boundariesRef.current, selectedBlockId);
    });

    // Clicking a block polygon selects it, just like its marker.
    map.on("click", "block-fill", (e) => {
      const id = e.features?.[0]?.properties?.block_id;
      const block = typeof id === "number" ? blockById.get(id) : undefined;
      if (block) drillRef.current(block);
    });
    map.on("mouseenter", "block-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "block-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", CIRCLES, (e) => {
      const id = e.features?.[0]?.properties?.blockId;
      const block = typeof id === "number" ? blockById.get(id) : undefined;
      if (block) drillRef.current(block);
    });
    map.on("mouseenter", CIRCLES, (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (f) {
        const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
        popup.setLngLat(coords).setText(String(f.properties?.name ?? "")).addTo(map);
      }
    });
    map.on("mouseleave", CIRCLES, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex h-[36rem] max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        {/* Left pane: blocks list, or a block's scan timeline */}
        <div className="flex w-80 shrink-0 flex-col border-r border-line bg-surface/60">
          {drill ? (
            <ScanPane
              block={drill}
              scans={scans}
              loading={scansLoading}
              error={scansError}
              combine={combine}
              onCombine={setCombine}
              onBack={() => setDrill(null)}
              onPick={(group) =>
                onSelect({
                  blockId: drill.blockId,
                  blockName: drill.blockName,
                  scanIds: group ? group.scanIds : null,
                  scanLabel: group ? scanLabel(group) : null,
                })
              }
            />
          ) : (
            <BlocksPane
              blocks={filtered}
              selectedBlockId={selectedBlockId}
              query={query}
              onQuery={setQuery}
              onPick={drillInto}
              onAll={() => onSelect({ blockId: null, blockName: null, scanIds: null, scanLabel: null })}
            />
          )}
        </div>

        {/* Map pane (always mounted) */}
        <div className="relative min-w-0 flex-1">
          <div ref={mapContainer} className="h-full w-full" />
          {located.length === 0 && (
            <div className="absolute inset-0 grid place-items-center bg-surface/80 text-sm text-ink-dim">
              These blocks don’t have map locations yet.
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg bg-raised/90 text-ink-dim shadow-md transition hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Blocks list pane                                                    */
/* ------------------------------------------------------------------ */

function BlocksPane({
  blocks,
  selectedBlockId,
  query,
  onQuery,
  onPick,
  onAll,
}: {
  blocks: CanaryBlock[];
  selectedBlockId: number | null;
  query: string;
  onQuery: (q: string) => void;
  onPick: (b: CanaryBlock) => void;
  onAll: () => void;
}) {
  return (
    <>
      <div className="border-b border-line p-3">
        <p className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold text-ink">
          <MapPin className="size-4 text-brand-600" />
          Select a block
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search blocks…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        <li>
          <button
            onClick={onAll}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
              selectedBlockId === null ? "bg-brand-500/12 text-brand-700" : "text-ink hover:bg-surface-2",
            )}
          >
            <Layers className="size-4 shrink-0 text-ink-faint" />
            <span className="flex-1 font-medium">All blocks</span>
            {selectedBlockId === null && <Check className="size-4 text-brand-600" />}
          </button>
        </li>
        {blocks.map((b) => (
          <li key={b.blockId}>
            <button
              onClick={() => onPick(b)}
              className={cn(
                "w-full rounded-lg px-2.5 py-2 text-left transition",
                b.blockId === selectedBlockId ? "bg-brand-500/12" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "block truncate text-sm font-medium",
                  b.blockId === selectedBlockId ? "text-brand-700" : "text-ink",
                )}
              >
                {b.blockName}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                {[b.ranchName, b.lastScanDate ? `scanned ${fmtAgo(b.lastScanDate)}` : "no scans"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
        {blocks.length === 0 && (
          <li className="px-2.5 py-2 text-sm text-ink-faint">No blocks match “{query}”.</li>
        )}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Scan timeline pane                                                  */
/* ------------------------------------------------------------------ */

function ScanPane({
  block,
  scans,
  loading,
  error,
  combine,
  onCombine,
  onBack,
  onPick,
}: {
  block: CanaryBlock;
  scans: CanaryScan[];
  loading: boolean;
  error: string | null;
  combine: boolean;
  onCombine: (v: boolean) => void;
  onBack: () => void;
  onPick: (group: ScanGroup | null) => void;
}) {
  const groups = useMemo(() => groupScans(scans, combine), [scans, combine]);

  return (
    <>
      <div className="border-b border-line p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
            aria-label="Back to blocks"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold text-ink">{block.blockName}</p>
            <p className="truncate text-[11px] text-ink-faint">Pick a scan to analyze</p>
          </div>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-ink-dim">
            Combine
            <button
              onClick={() => onCombine(!combine)}
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                combine ? "bg-brand-500" : "bg-surface-2",
              )}
              role="switch"
              aria-checked={combine}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-all",
                  combine ? "left-[0.875rem]" : "left-0.5",
                )}
              />
            </button>
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          onClick={() => onPick(null)}
          className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-surface-2"
        >
          <Layers className="size-4 shrink-0 text-ink-faint" />
          <span className="flex-1 font-medium">Whole block</span>
          <span className="text-[11px] text-ink-faint">no specific scan</span>
        </button>

        {loading && (
          <p className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-ink-faint">
            <Loader2 className="size-4 animate-spin" /> Loading scans…
          </p>
        )}
        {error && <p className="px-2.5 py-2 text-sm text-danger">{error}</p>}
        {!loading && !error && groups.length === 0 && (
          <p className="px-2.5 py-2 text-sm text-ink-faint">No scans for this block yet.</p>
        )}

        <ol className="space-y-1">
          {groups.map((g) => (
            <li key={g.scanIds.join("-")}>
              <button
                onClick={() => onPick(g)}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-brand-300 hover:bg-brand-500/5"
              >
                <span className="flex items-center gap-1.5">
                  <span className="block truncate text-sm font-medium text-ink">
                    {g.scanNames.join(" / ")}
                  </span>
                  {g.scanIds.length > 1 && (
                    <span className="shrink-0 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                      {g.scanIds.length} scans
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                  <span>{fmtScanWhen(g.time)}</span>
                  {g.stage && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-dim">{g.stage}</span>
                  )}
                  {g.trees != null && g.trees > 0 && <span>{g.trees.toLocaleString()} trees</span>}
                  {g.rows != null && g.rows > 0 && <span>{g.rows} rows</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
