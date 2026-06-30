import type { StyleSpecification } from "maplibre-gl";

/**
 * Mapbox access token — the SAME public `pk.*` token FruitScope uses. It's a
 * public, URL-restrictable token meant to ship in the client bundle, but it's
 * injected at build time (never committed) so GitHub secret scanning stays
 * happy. Resolution:
 *   1. window.MAPBOX_TOKEN              (runtime injection)
 *   2. import.meta.env.VITE_MAPBOX_TOKEN (build-time env — set in CI + .env.local)
 */
export const MAPBOX_TOKEN: string =
  (typeof window !== "undefined" && (window as { MAPBOX_TOKEN?: string }).MAPBOX_TOKEN) ||
  (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ||
  "";

/**
 * A MapLibre style that renders Mapbox's `satellite-streets` basemap as raster
 * tiles (MapLibre dropped native `mapbox://` support, but the Static-Tiles API
 * works as a plain raster source). Same imagery FruitScope uses for blocks.
 */
export const mapboxSatelliteStyle = (): StyleSpecification => ({
  version: 8,
  // Required for any text (symbol) layers — MapLibre renders no labels without it.
  glyphs: `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${MAPBOX_TOKEN}`,
  sources: {
    "mapbox-satellite": {
      type: "raster",
      tiles: [
        `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v9/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      ],
      tileSize: 256,
      attribution: "© Mapbox © OpenStreetMap",
    },
  },
  layers: [{ id: "mapbox-satellite", type: "raster", source: "mapbox-satellite" }],
});
