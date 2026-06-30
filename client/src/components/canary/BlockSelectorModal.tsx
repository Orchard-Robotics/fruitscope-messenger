import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, Layers, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CanaryBlock } from "@/lib/canary";
import { cn } from "@/lib/cn";
import { mapboxSatelliteStyle } from "@/lib/mapbox";

const CIRCLES = "blocks-circles";

/** ms timestamp of a block's latest scan (0 if it has never been scanned). */
const scanTime = (b: CanaryBlock): number => (b.lastScanDate ? Date.parse(b.lastScanDate) || 0 : 0);

function fmtDate(iso: string | null): string {
  if (!iso) return "No scans yet";
  const t = Date.parse(iso);
  if (!t) return "No scans yet";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "Scanned today";
  if (days === 1) return "Scanned yesterday";
  if (days < 30) return `Scanned ${days}d ago`;
  return `Scanned ${new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

/**
 * The FruitScope-style block picker: a recency-ordered, searchable list paired
 * with a MapLibre satellite map (Mapbox imagery) whose markers are coloured by
 * scan recency and selectable. Picking from either side chooses the block.
 */
export function BlockSelectorModal({
  blocks,
  selectedBlockId,
  onSelect,
  onClose,
}: {
  blocks: CanaryBlock[];
  selectedBlockId: number | null;
  onSelect: (blockId: number | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const mapContainer = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Newest scan first; un-scanned blocks sink to the bottom.
  const ordered = useMemo(() => [...blocks].sort((a, b) => scanTime(b) - scanTime(a)), [blocks]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (b) => b.blockName.toLowerCase().includes(q) || b.ranchName?.toLowerCase().includes(q),
    );
  }, [ordered, query]);

  const located = useMemo(() => blocks.filter((b) => b.lat != null && b.lon != null), [blocks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ----- the map (created once when the modal opens) ----- */
  useEffect(() => {
    if (!mapContainer.current) return;

    // Recency 0..1 (1 = most recent) for the colour ramp.
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    map.on("load", () => {
      map.resize();
      if (features.length) {
        const b = new maplibregl.LngLatBounds();
        for (const f of features) b.extend(f.geometry.coordinates as [number, number]);
        map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
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
          // gray (old) → amber → green (recent)
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "recency"],
            0,
            "#9ca3af",
            0.5,
            "#eab308",
            1,
            "#22c55e",
          ],
        },
      });
      map.addLayer({
        id: "blocks-selected",
        type: "circle",
        source: "blocks",
        filter: ["==", ["get", "blockId"], selectedBlockId ?? -1],
        paint: {
          "circle-radius": 11,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#3f8a66",
          "circle-stroke-width": 3,
        },
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
          // The user wants every block named — show all labels, even if they overlap.
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.4 },
      });
    });

    map.on("click", CIRCLES, (e) => {
      const id = e.features?.[0]?.properties?.blockId;
      if (typeof id === "number") onSelectRef.current(id);
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

    return () => map.remove();
    // Created once per open; selection closes the modal so live updates aren't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex h-[36rem] max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        {/* List pane */}
        <div className="flex w-72 shrink-0 flex-col border-r border-line bg-surface/60">
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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search blocks…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            <li>
              <button
                onClick={() => onSelect(null)}
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
            {filtered.map((b) => {
              const selected = b.blockId === selectedBlockId;
              return (
                <li key={b.blockId}>
                  <button
                    onClick={() => onSelect(b.blockId)}
                    className={cn(
                      "w-full rounded-lg px-2.5 py-2 text-left transition",
                      selected ? "bg-brand-500/12" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "block truncate text-sm font-medium",
                          selected ? "text-brand-700" : "text-ink",
                        )}
                      >
                        {b.blockName}
                      </span>
                      {selected && <Check className="size-3.5 shrink-0 text-brand-600" />}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {[b.ranchName, fmtDate(b.lastScanDate)].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2.5 py-2 text-sm text-ink-faint">No blocks match “{query}”.</li>
            )}
          </ul>
        </div>

        {/* Map pane */}
        <div className="relative min-w-0 flex-1">
          <div ref={mapContainer} className="absolute inset-0" />
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
