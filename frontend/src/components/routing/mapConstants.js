/**
 * Geographical Boundaries, Landmarks, and Tile Configurations
 * ============================================================
 * Phase 10.1: Interactive Map Foundation for Smart Route Planner
 *
 * Geographical Region: Chandigarh Tricity
 * - West: 76.5900
 * - South: 30.5400
 * - East: 76.9300
 * - North: 30.8500
 */

// Bounding box for Chandigarh Tricity region [[south, west], [north, east]]
export const TRICITY_BOUNDS = [
  [30.5400, 76.5900], // South-West (Dera Bassi / Banur / Kharar bypass)
  [30.8500, 76.9300], // North-East (New Chandigarh / Panchkula East)
];

// Default geographical center (Chandigarh Sector 17 / Capital Grid)
export const TRICITY_CENTER = [30.7333, 76.7794];

// Default zoom configurations
export const DEFAULT_ZOOM = 11;
export const MIN_ZOOM = 9;
export const MAX_ZOOM = 18;

// Regional target urban centers in Chandigarh Tricity
export const TRICITY_LANDMARKS = [
  {
    id: "chandigarh",
    name: "Chandigarh",
    subtitle: "Capital & Planned Grid",
    coordinates: [30.7333, 76.7794],
    zoom: 13,
  },
  {
    id: "mohali",
    name: "Mohali (SAS Nagar)",
    subtitle: "IT Corridor & Sectors 53-115",
    coordinates: [30.7046, 76.7179],
    zoom: 13,
  },
  {
    id: "panchkula",
    name: "Panchkula",
    subtitle: "Foothills & Sectors 1-32",
    coordinates: [30.6942, 76.8606],
    zoom: 13,
  },
  {
    id: "zirakpur",
    name: "Zirakpur",
    subtitle: "NH-152 / NH-7 Junction Corridor",
    coordinates: [30.6425, 76.8173],
    zoom: 14,
  },
  {
    id: "kharar",
    name: "Kharar",
    subtitle: "NH-5 / NH-205 Northwest Hub",
    coordinates: [30.7499, 76.6411],
    zoom: 14,
  },
  {
    id: "new_chandigarh",
    name: "New Chandigarh",
    subtitle: "EcoCity & Medicity Corridor",
    coordinates: [30.8050, 76.7150],
    zoom: 13,
  },
  {
    id: "dera_bassi",
    name: "Dera Bassi",
    subtitle: "Southern Industrial Gateway",
    coordinates: [30.5833, 76.8444],
    zoom: 14,
  },
];

// Retrieve CARTO Basemap API Key from Vite or Node environment
const rawCartoKey =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_CARTO_API_KEY
    : typeof globalThis !== "undefined" && globalThis.process?.env
    ? globalThis.process.env.VITE_CARTO_API_KEY
    : undefined;

export const isCartoKeyConfigured =
  typeof rawCartoKey === "string" &&
  rawCartoKey.trim().length > 0 &&
  rawCartoKey.trim() !== "YOUR_CARTO_API_KEY_HERE";

export const CARTO_API_KEY = isCartoKeyConfigured ? rawCartoKey.trim() : null;

// Helper to construct CARTO raster tile URL with API key query parameter when configured
// Note: CARTO Basemaps raster tile endpoint specifically requires '?key=' (not '?api_key=')
function buildCartoTileUrl(basePath) {
  const baseUrl = `https://{s}.basemaps.cartocdn.com/${basePath}/{z}/{x}/{y}{r}.png`;
  if (isCartoKeyConfigured && CARTO_API_KEY) {
    return `${baseUrl}?key=${encodeURIComponent(CARTO_API_KEY)}`;
  }
  return baseUrl;
}

// Development warning if CARTO API key is not yet configured
if (!isCartoKeyConfigured && typeof window !== "undefined" && typeof import.meta !== "undefined" && import.meta.env?.DEV) {
  console.warn(
    "[CARTO Basemaps] VITE_CARTO_API_KEY is unconfigured or set to placeholder in frontend/.env.local. " +
    "Default tile provider has safely fallen back to OpenStreetMap Standard (osm-standard)."
  );
}

// Configurable Map Tile Providers
export const TILE_PROVIDERS = [
  {
    id: "carto-voyager",
    name: "Clean Navigation",
    description: isCartoKeyConfigured
      ? "High-contrast road network and clear terrain (CARTO)"
      : "High-contrast road network (CARTO Basemaps)",
    url: buildCartoTileUrl("rastertiles/voyager"),
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  },
  {
    id: "osm-standard",
    name: "OpenStreetMap",
    description: "Standard community-mapped topographic tiles",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    subdomains: "abc",
    maxZoom: 19,
  },
  {
    id: "carto-dark",
    name: "Dark Matrix",
    description: isCartoKeyConfigured
      ? "Low-light dark theme matching application UI (CARTO)"
      : "Low-light dark theme (CARTO Basemaps)",
    url: buildCartoTileUrl("dark_all"),
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  },
];

export const DEFAULT_TILE_PROVIDER = isCartoKeyConfigured
  ? TILE_PROVIDERS.find((p) => p.id === "carto-voyager") || TILE_PROVIDERS[0]
  : TILE_PROVIDERS.find((p) => p.id === "osm-standard") || TILE_PROVIDERS[0];

// Architectural Theme Styling for Route Polylines and Markers
export const ROUTE_STYLES = {
  recommended: {
    color: "#10b981", // Emerald 500
    weight: 6,
    opacity: 0.9,
    dashArray: null,
  },
  alternative: {
    color: "#6366f1", // Indigo 500
    weight: 5,
    opacity: 0.75,
    dashArray: "6, 6",
  },
  selected: {
    color: "#06b6d4", // Cyan 500
    weight: 7,
    opacity: 1.0,
    dashArray: null,
  },
  boundary: {
    color: "#3b82f6", // Blue 500
    weight: 2,
    opacity: 0.6,
    dashArray: "8, 6",
    fillColor: "#3b82f6",
    fillOpacity: 0.03,
  },
};

// Distinct colors for alternative candidate routes
export const ALTERNATIVE_ROUTE_COLORS = [
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#3b82f6", // Blue
];

/**
 * Validate whether a coordinate pair [lat, lon] is strictly inside the Chandigarh Tricity bounding box.
 */
export function isWithinTricityRegion(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return false;
  const [south, west] = TRICITY_BOUNDS[0];
  const [north, east] = TRICITY_BOUNDS[1];
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

/**
 * Format a coordinate pair into a human-readable geographic string.
 */
export function formatCoordinate(lat, lon, decimals = 4) {
  if (typeof lat !== "number" || typeof lon !== "number") return "";
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(decimals)}°${latDir}, ${Math.abs(lon).toFixed(decimals)}°${lonDir}`;
}

/**
 * Calculate Great-Circle (Haversine) distance between two [lat, lon] coordinates in kilometers.
 */
export function calculateHaversineDistanceKm(coordA, coordB) {
  if (!coordA || !coordB || coordA.length < 2 || coordB.length < 2) return null;
  const [lat1, lon1] = coordA;
  const [lat2, lon2] = coordB;
  const R = 6371.0; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

