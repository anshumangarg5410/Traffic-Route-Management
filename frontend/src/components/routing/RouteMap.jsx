import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Rectangle,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  AlertTriangle,
  RefreshCw,
  Compass,
  MapPin,
  X,
} from "lucide-react";
import MapControls from "./MapControls";
import MapLegend from "./MapLegend";
import {
  TRICITY_BOUNDS,
  TRICITY_CENTER,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  TRICITY_LANDMARKS,
  TILE_PROVIDERS,
  DEFAULT_TILE_PROVIDER,
  ROUTE_STYLES,
  ALTERNATIVE_ROUTE_COLORS,
  formatCoordinate,
} from "./mapConstants";

/**
 * Custom SVG Marker Icon Factory
 * ==============================
 * Renders vector-sharp, theme-matched SVG markers that resolve without
 * relying on brittle relative image asset paths in bundlers.
 */
function createCustomDivIcon(color, label, iconSvg) {
  return L.divIcon({
    className: "custom-map-marker",
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(15, 23, 42, 0.9);
        border: 2px solid ${color};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        color: ${color};
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      ">
        ${iconSvg || label}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

const landmarkDivIcon = L.divIcon({
  className: "custom-landmark-marker",
  html: `
    <div style="
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #8b5cf6;
      border: 2px solid #ffffff;
      box-shadow: 0 0 8px rgba(139, 92, 246, 0.8);
      cursor: pointer;
    "></div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -10],
});

/**
 * Phase 10.5 Custom Intersection Markers
 * - Signalized: Amber theme with traffic light icon
 * - Topological: Indigo theme with junction # sequence badge
 */
function createSignalDivIcon(isSelected) {
  const size = isSelected ? 34 : 26;
  const half = size / 2;
  const borderColor = isSelected ? "#38bdf8" : "#f59e0b";
  const bg = isSelected ? "rgba(8, 47, 73, 0.95)" : "rgba(15, 23, 42, 0.95)";
  const shadow = isSelected
    ? "0 0 16px rgba(56, 189, 248, 0.95), 0 4px 12px rgba(0,0,0,0.6)"
    : "0 2px 8px rgba(0,0,0,0.5)";

  return L.divIcon({
    className: "custom-signal-marker",
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${bg};
        border: 2px solid ${borderColor};
        box-shadow: ${shadow};
        cursor: pointer;
        transition: transform 0.15s ease;
      ">
        <span style="font-size: ${isSelected ? 14 : 11}px; line-height: 1;">🚦</span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -half - 2],
  });
}

function createJunctionDivIcon(isSelected, seq) {
  const size = isSelected ? 30 : 22;
  const half = size / 2;
  const borderColor = isSelected ? "#38bdf8" : "#818cf8";
  const bg = isSelected ? "rgba(8, 47, 73, 0.95)" : "rgba(15, 23, 42, 0.95)";
  const shadow = isSelected
    ? "0 0 16px rgba(56, 189, 248, 0.95), 0 4px 12px rgba(0,0,0,0.6)"
    : "0 2px 6px rgba(0,0,0,0.4)";

  return L.divIcon({
    className: "custom-junction-marker",
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${bg};
        border: 2px solid ${borderColor};
        box-shadow: ${shadow};
        color: ${borderColor};
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: ${isSelected ? 11 : 9}px;
        font-weight: 700;
        cursor: pointer;
      ">
        ${seq || "#"}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -half - 2],
  });
}

/**
 * Map Controller Helper Component
 * ===============================
 * Subscribes to the underlying Leaflet instance for imperative camera actions:
 * zoom in/out, fitBounds, setView, and auto-resize invalidation.
 */
function MapImperativeBridge({ onRegisterController }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    // Expose programmatic controls to parent component
    onRegisterController({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      fitBounds: (bounds, options) => {
        map.fitBounds(bounds, {
          padding: [40, 40],
          maxZoom: 15,
          animate: true,
          ...options,
        });
      },
      setView: (center, zoom, options) => {
        map.setView(center, zoom, { animate: true, ...options });
      },
      invalidateSize: () => {
        map.invalidateSize();
      },
    });

    // Ensure map tiles calculate correct dimensions after initial DOM layout
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => clearTimeout(timer);
  }, [map, onRegisterController]);

  return null;
}

/**
 * Map Click Events Bridge
 */
function MapEventsBridge({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

/**
 * Dynamic Viewport Camera Controller
 * ==================================
 * Adjusts the map view sensibly:
 * - When candidate routes are present: fits bounds to all valid route paths.
 * - When source and/or destination are chosen: fits bounds or centers on the point.
 * - Preserves user manual panning and avoids resetting camera when only route selection changes.
 */
function MapCameraController({ sourceCoord, destCoord, routes = [] }) {
  const map = useMap();
  const prevCoordRef = useRef({ source: null, dest: null });
  const prevRoutesSignatureRef = useRef("");

  useEffect(() => {
    // 1. If candidate routes are present, auto-fit to all valid route paths
    const validRoutes = (routes || []).filter(
      (r) =>
        r?.geometry?.coordinates &&
        Array.isArray(r.geometry.coordinates) &&
        r.geometry.coordinates.length >= 2
    );

    const routesSignature = validRoutes
      .map((r) => `${r.route_id}:${r.geometry.coordinates.length}`)
      .join("|");

    if (validRoutes.length > 0) {
      if (routesSignature !== prevRoutesSignatureRef.current) {
        prevRoutesSignatureRef.current = routesSignature;

        const allLatLngs = [];
        for (const route of validRoutes) {
          for (const pt of route.geometry.coordinates) {
            if (
              Array.isArray(pt) &&
              pt.length >= 2 &&
              typeof pt[0] === "number" &&
              typeof pt[1] === "number" &&
              !isNaN(pt[0]) &&
              !isNaN(pt[1])
            ) {
              // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
              allLatLngs.push([pt[1], pt[0]]);
            }
          }
        }

        if (allLatLngs.length >= 2) {
          const bounds = L.latLngBounds(allLatLngs);
          map.fitBounds(bounds, {
            padding: [60, 60],
            maxZoom: 15,
            animate: true,
          });
        }
      }
      return;
    }

    // 2. Fall back to fitting source and destination when routes are empty/cleared
    prevRoutesSignatureRef.current = "";

    const hasSource =
      Array.isArray(sourceCoord) &&
      sourceCoord.length === 2 &&
      typeof sourceCoord[0] === "number" &&
      typeof sourceCoord[1] === "number";

    const hasDest =
      Array.isArray(destCoord) &&
      destCoord.length === 2 &&
      typeof destCoord[0] === "number" &&
      typeof destCoord[1] === "number";

    const prev = prevCoordRef.current;
    const sourceChanged =
      (!prev.source && hasSource) ||
      (prev.source && !hasSource) ||
      (hasSource && (prev.source[0] !== sourceCoord[0] || prev.source[1] !== sourceCoord[1]));

    const destChanged =
      (!prev.dest && hasDest) ||
      (prev.dest && !hasDest) ||
      (hasDest && (prev.dest[0] !== destCoord[0] || prev.dest[1] !== destCoord[1]));

    prevCoordRef.current = {
      source: hasSource ? [...sourceCoord] : null,
      dest: hasDest ? [...destCoord] : null,
    };

    if (!sourceChanged && !destChanged) return;

    if (hasSource && hasDest) {
      const bounds = L.latLngBounds([sourceCoord, destCoord]);
      map.fitBounds(bounds, {
        padding: [60, 60],
        maxZoom: 14,
        animate: true,
      });
    } else if (hasSource && sourceChanged) {
      map.setView(sourceCoord, 14, { animate: true });
    } else if (hasDest && destChanged) {
      map.setView(destCoord, 14, { animate: true });
    }
  }, [map, sourceCoord, destCoord, routes]);

  return null;
}

/**
 * RouteMap Component
 * ==================
 * Interactive geographical map canvas configured for Chandigarh Tricity.
 *
 * Props:
 * - className: custom Tailwind classes
 * - showControls: render floating navigation and layer controls (default: true)
 * - showLegend: render floating legend card (default: true)
 * - showBoundary: render Tricity rectangular bounding box (default: true)
 * - showLandmarks: render regional target area landmarks (default: true)
 * - initialCenter: [lat, lon] initial map center (default: TRICITY_CENTER)
 * - initialZoom: initial zoom level (default: DEFAULT_ZOOM)
 * - sourceCoordinate: [lat, lon] for planned source pin (Phase 10.2 ready)
 * - destinationCoordinate: [lat, lon] for planned destination pin (Phase 10.2 ready)
 * - routes: Array of candidate route objects (Phase 10.2 ready)
 * - selectedRouteId: ID of currently selected route
 * - recommendedRouteId: ID of recommended route
 * - onMapClick: callback when user clicks map canvas
 * - onRouteSelect: callback when user selects a route
 */
export default function RouteMap({
  className = "",
  showControls = true,
  showLegend = true,
  showBoundary: initialShowBoundary = true,
  showLandmarks = true,
  initialCenter = TRICITY_CENTER,
  initialZoom = DEFAULT_ZOOM,
  source = null,
  destination = null,
  sourceCoordinate = null,
  destinationCoordinate = null,
  selectionMode = null,
  onCancelSelectionMode = null,
  routes = [],
  selectedRouteId = null,
  recommendedRouteId = null,
  onMapClick = null,
  onRouteSelect = null,
  selectedIntersectionNodeId = null,
  onIntersectionSelect = null,
}) {
  const [selectedTileId, setSelectedTileId] = useState(DEFAULT_TILE_PROVIDER.id);
  const [isBoundaryVisible, setIsBoundaryVisible] = useState(initialShowBoundary);
  const [isMapReady, setIsMapReady] = useState(false);
  const [hasTileError, setHasTileError] = useState(false);

  const containerRef = useRef(null);
  const controllerRef = useRef(null);
  const markerRefs = useRef({});

  // Normalize source and destination coordinates and display names
  const effectiveSourceCoord = source?.coordinates || sourceCoordinate || null;
  const effectiveSourceDisplayName = source?.displayName || "Origin / Source";

  const effectiveDestCoord = destination?.coordinates || destinationCoordinate || null;
  const effectiveDestDisplayName = destination?.displayName || "Destination";

  // Active tile provider object
  const activeTile =
    TILE_PROVIDERS.find((p) => p.id === selectedTileId) || DEFAULT_TILE_PROVIDER;

  // Active route for intersection inspection
  const activeRoute = useMemo(() => {
    if (!routes || routes.length === 0) return null;
    return routes.find((r) => r.route_id === selectedRouteId) || routes[0];
  }, [routes, selectedRouteId]);

  // Extract, validate, and sequence intersections for the currently selected route
  const selectedRouteIntersections = useMemo(() => {
    if (!activeRoute || !activeRoute.intersection_analysis) return [];
    const matches = Array.isArray(activeRoute.intersection_analysis.matched_intersections)
      ? activeRoute.intersection_analysis.matched_intersections
      : [];

    const signalDelays = Array.isArray(activeRoute.signal_delay_summary?.signal_delays)
      ? activeRoute.signal_delay_summary.signal_delays
      : [];
    const delayMap = new Map();
    for (const sd of signalDelays) {
      if (sd && sd.osm_node_id != null) {
        delayMap.set(String(sd.osm_node_id), sd);
      }
    }

    return matches
      .filter(
        (i) =>
          i &&
          i.osm_node_id != null &&
          typeof i.latitude === "number" &&
          typeof i.longitude === "number" &&
          !Number.isNaN(i.latitude) &&
          !Number.isNaN(i.longitude)
      )
      .sort((a, b) => (a.distance_along_route_m || 0) - (b.distance_along_route_m || 0))
      .map((i, idx) => ({
        ...i,
        seq: idx + 1,
        delayInfo: i.is_signalized ? delayMap.get(String(i.osm_node_id)) || null : null,
      }));
  }, [activeRoute]);

  // Programmatic pan and popup activation when an intersection is selected from the list
  useEffect(() => {
    if (!selectedIntersectionNodeId) return;
    const targetMarker = markerRefs.current[String(selectedIntersectionNodeId)];
    if (targetMarker) {
      targetMarker.openPopup();
      const latLng = targetMarker.getLatLng();
      if (latLng) {
        controllerRef.current?.setView([latLng.lat, latLng.lng], 15);
      }
    }
  }, [selectedIntersectionNodeId]);

  // Sort routes to guarantee visual stacking hierarchy:
  // Unselected alternatives first, then Recommended route, and Selected route rendered last (on top)
  const sortedRoutes = useMemo(() => {
    return [...routes].sort((a, b) => {
      if (a.route_id === selectedRouteId) return 1;
      if (b.route_id === selectedRouteId) return -1;
      const aRec = a.is_recommended || a.route_id === recommendedRouteId;
      const bRec = b.is_recommended || b.route_id === recommendedRouteId;
      if (aRec && !bRec) return 1;
      if (!aRec && bRec) return -1;
      return 0;
    });
  }, [routes, selectedRouteId, recommendedRouteId]);

  // Handle registration from imperative bridge
  const handleRegisterController = useCallback((controller) => {
    controllerRef.current = controller;
  }, []);

  // Action handlers
  const handleZoomIn = () => {
    controllerRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    controllerRef.current?.zoomOut();
  };

  const handleResetView = () => {
    controllerRef.current?.fitBounds(TRICITY_BOUNDS);
  };

  const handleRecenter = () => {
    controllerRef.current?.setView(TRICITY_CENTER, DEFAULT_ZOOM);
  };

  const handleSelectLandmark = (landmark) => {
    controllerRef.current?.setView(landmark.coordinates, landmark.zoom);
  };

  // Watch container resizing with ResizeObserver to prevent grey tile seams
  useEffect(() => {
    if (!containerRef.current) return;

    let resizeTimer = null;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        controllerRef.current?.invalidateSize();
      }, 100);
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full min-h-[480px] sm:min-h-[540px] md:min-h-[580px] lg:min-h-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl ${
        selectionMode ? "cursor-crosshair [&_.leaflet-container]:!cursor-crosshair" : ""
      } ${className}`}
    >
      {/* Floating Selection Mode Indicator Banner */}
      {selectionMode && (
        <div className="absolute top-4 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-2.5 rounded-full border border-purple-500/50 bg-slate-900/95 px-4 py-2 shadow-2xl backdrop-blur-md">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-purple-500" />
          </span>
          <span className="text-xs font-medium text-white">
            Click map to set{" "}
            <strong className={selectionMode === "source" ? "text-emerald-400" : "text-rose-400"}>
              {selectionMode === "source" ? "Origin (A)" : "Destination (B)"}
            </strong>
          </span>
          {onCancelSelectionMode && (
            <button
              type="button"
              onClick={onCancelSelectionMode}
              className="ml-1.5 flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none"
              aria-label="Cancel map-click selection mode"
            >
              <X size={10} />
              <span>Cancel</span>
            </button>
          )}
        </div>
      )}

      {/* Loading Shimmer Overlay */}
      {!isMapReady && (
        <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 shadow-xl">
            <RefreshCw size={18} className="animate-spin text-emerald-400" />
            <span className="text-xs font-medium text-slate-200">
              Initializing Chandigarh Tricity Map...
            </span>
          </div>
        </div>
      )}

      {/* Tile Error Warning Banner */}
      {hasTileError && (
        <div className="absolute top-4 left-4 z-[1000] flex max-w-md items-center gap-2.5 rounded-xl border border-amber-500/40 bg-slate-900/95 p-3 shadow-xl backdrop-blur-md">
          <AlertTriangle size={18} className="shrink-0 text-amber-400" />
          <div className="text-xs">
            <p className="font-semibold text-white">Tile Stream Notice</p>
            <p className="text-slate-400">
              Some map tiles could not be fetched. Switch tile provider in layer controls or check internet connection.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHasTileError(false)}
            className="ml-auto rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
            aria-label="Dismiss tile stream notice"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* React-Leaflet Map Canvas */}
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomControl={false}
        className="h-full w-full z-0"
        whenReady={() => setIsMapReady(true)}
      >
        <MapImperativeBridge onRegisterController={handleRegisterController} />
        <MapEventsBridge onMapClick={onMapClick} />
        <MapCameraController
          sourceCoord={effectiveSourceCoord}
          destCoord={effectiveDestCoord}
          routes={routes}
        />

        {/* Dynamic Tile Layer */}
        <TileLayer
          key={activeTile.id}
          url={activeTile.url}
          attribution={activeTile.attribution}
          subdomains={activeTile.subdomains}
          maxZoom={activeTile.maxZoom}
          eventHandlers={{
            tileerror: () => setHasTileError(true),
          }}
        />

        {/* Tricity Regional Bounding Box Boundary */}
        {isBoundaryVisible && (
          <Rectangle
            bounds={TRICITY_BOUNDS}
            pathOptions={{
              color: ROUTE_STYLES.boundary.color,
              weight: ROUTE_STYLES.boundary.weight,
              dashArray: ROUTE_STYLES.boundary.dashArray,
              fillColor: ROUTE_STYLES.boundary.fillColor,
              fillOpacity: ROUTE_STYLES.boundary.fillOpacity,
            }}
          >
            <Popup className="custom-leaflet-popup">
              <div className="p-1 text-slate-900">
                <p className="font-bold text-xs">Chandigarh Tricity Scope</p>
                <p className="text-[11px] text-slate-600">
                  Regional bounding box: 76.59°E to 76.93°E, 30.54°N to 30.85°N (~35 km × 35 km).
                </p>
              </div>
            </Popup>
          </Rectangle>
        )}

        {/* Route Polylines (Sorted to guarantee that Selected Route is drawn on top) */}
        {sortedRoutes.map((route, idx) => {
          const isRecommended =
            route.is_recommended || route.route_id === recommendedRouteId;
          const isSelected = route.route_id === selectedRouteId;

          // Pick alternative color deterministically from ALTERNATIVE_ROUTE_COLORS
          const altColor =
            ALTERNATIVE_ROUTE_COLORS[idx % ALTERNATIVE_ROUTE_COLORS.length];

          const style = isSelected
            ? {
                color: isRecommended ? "#10b981" : "#06b6d4",
                weight: 8,
                opacity: 1.0,
                dashArray: null,
              }
            : isRecommended
            ? {
                color: "#10b981",
                weight: 6,
                opacity: 0.85,
                dashArray: null,
              }
            : {
                color: altColor,
                weight: 5,
                opacity: 0.75,
                dashArray: "6, 6",
              };

          // Robust conversion of GeoJSON [lon, lat] coordinates to Leaflet [lat, lon]
          const coords = (route.geometry?.coordinates || [])
            .filter(
              (pt) =>
                Array.isArray(pt) &&
                pt.length >= 2 &&
                typeof pt[0] === "number" &&
                typeof pt[1] === "number" &&
                !isNaN(pt[0]) &&
                !isNaN(pt[1])
            )
            .map(([lon, lat]) => [lat, lon]);

          if (coords.length < 2) return null;

          const signalCount =
            route.signal_delay_summary?.signal_count ??
            route.intersection_analysis?.signalized_intersection_nodes ??
            0;

          const displayDurationMin =
            route.signal_delay_summary?.estimated_duration_min ??
            route.duration_min;

          return (
            <Polyline
              key={route.route_id}
              positions={coords}
              pathOptions={{
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                dashArray: style.dashArray,
              }}
              eventHandlers={{
                click: () => onRouteSelect?.(route.route_id),
              }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[170px] text-slate-900">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                    <p className="font-bold text-xs text-slate-900">
                      {route.summary || `Route ${idx + 1}`}
                    </p>
                    {isRecommended ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                        Recommended
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                        Alternative
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
                    <div>
                      <span className="text-slate-400">Dist:</span>{" "}
                      <strong className="text-slate-800">{route.distance_km} km</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Est. Time:</span>{" "}
                      <strong className="text-slate-800">
                        {displayDurationMin.toFixed(1)} min
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Signals:</span>{" "}
                      <strong className="text-slate-800">{signalCount}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Rank:</span>{" "}
                      <strong className="text-slate-800">#{route.rank ?? (idx + 1)}</strong>
                    </div>
                  </div>
                  {!isSelected && (
                    <button
                      type="button"
                      onClick={() => onRouteSelect?.(route.route_id)}
                      className="mt-2 w-full rounded bg-blue-600 py-1 text-center text-[10px] font-semibold text-white transition hover:bg-blue-700"
                    >
                      Select Route
                    </button>
                  )}
                </div>
              </Popup>
            </Polyline>
          );
        })}

        {/* Selected Route Intersections & Signal Markers (Phase 10.5) */}
        {selectedRouteIntersections.map((inter, idx) => {
          const isSelected = String(inter.osm_node_id) === String(selectedIntersectionNodeId);
          const icon = inter.is_signalized
            ? createSignalDivIcon(isSelected)
            : createJunctionDivIcon(isSelected, inter.seq);

          const distKm = (inter.distance_along_route_m / 1000).toFixed(2);
          const distDisplay =
            inter.distance_along_route_m >= 1000
              ? `${distKm} km`
              : `${Math.round(inter.distance_along_route_m)} m`;
          const delayS = inter.delayInfo?.estimated_delay_s ?? 20.0;

          return (
            <Marker
              key={`inter-${inter.osm_node_id}-${idx}`}
              position={[inter.latitude, inter.longitude]}
              icon={icon}
              ref={(el) => {
                if (el) {
                  markerRefs.current[String(inter.osm_node_id)] = el;
                }
              }}
              eventHandlers={{
                click: () => {
                  onIntersectionSelect?.(inter.osm_node_id, [inter.latitude, inter.longitude]);
                },
              }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[190px] text-slate-900">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <span>#{inter.seq}</span>
                      {inter.is_signalized ? (
                        <span className="text-amber-600 flex items-center gap-1">
                          <span>🚦</span>
                          <span>Mapped Signal</span>
                        </span>
                      ) : (
                        <span className="text-indigo-600">🔀 Topological Node (No Signal Tag)</span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-slate-400">
                      #{inter.osm_node_id}
                    </span>
                  </div>

                  <div className="mt-1.5 space-y-1 text-[11px] text-slate-600">
                    <div>
                      <span className="text-slate-400">Route Dist:</span>{" "}
                      <strong className="text-slate-800">{distDisplay} from start</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Offset:</span>{" "}
                      <strong className="text-slate-800">
                        {inter.distance_from_route_m.toFixed(1)} m
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Coordinates:</span>{" "}
                      <span className="font-mono text-[10px] text-slate-700">
                        {formatCoordinate(inter.latitude, inter.longitude)}
                      </span>
                    </div>

                    {inter.is_signalized ? (
                      <div className="mt-1 rounded bg-amber-50 p-1.5 text-[10px] text-amber-900 border border-amber-200">
                        <div>
                          <strong>Modeled Delay:</strong> ~{delayS.toFixed(1)}s (uniform)
                        </div>
                        {inter.delayInfo && (
                          <div className="font-mono text-[9px] text-amber-700 mt-0.5">
                            Cycle: {inter.delayInfo.cycle_length_s}s | Red: {inter.delayInfo.effective_red_time_s}s
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 rounded bg-slate-100 p-1 text-[10px] text-slate-600 italic">
                        No mapped signal tag &bull; Individual delay not modeled
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onIntersectionSelect?.(inter.osm_node_id, [inter.latitude, inter.longitude]);
                    }}
                    className="mt-2 w-full rounded bg-cyan-600 py-1 text-center text-[10px] font-semibold text-white transition hover:bg-cyan-700"
                  >
                    Select in Inspection Panel
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Regional Target Landmarks */}
        {showLandmarks &&
          TRICITY_LANDMARKS.map((landmark) => (
            <Marker
              key={landmark.id}
              position={landmark.coordinates}
              icon={landmarkDivIcon}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 text-slate-900">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-purple-700">
                    <Compass size={13} />
                    <span>{landmark.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {landmark.subtitle}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 mt-1">
                    {landmark.coordinates[0].toFixed(4)}°N, {landmark.coordinates[1].toFixed(4)}°E
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}

        {/* Source / Origin Pin (A) */}
        {effectiveSourceCoord && (
          <Marker
            position={effectiveSourceCoord}
            icon={createCustomDivIcon("#10b981", "A")}
          >
            <Popup className="custom-leaflet-popup">
              <div className="p-1 text-slate-900">
                <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-600">
                  <MapPin size={13} />
                  <span>Origin / Source (A)</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-800">
                  {effectiveSourceDisplayName}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {formatCoordinate(effectiveSourceCoord[0], effectiveSourceCoord[1])}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Destination Pin (B) */}
        {effectiveDestCoord && (
          <Marker
            position={effectiveDestCoord}
            icon={createCustomDivIcon("#ef4444", "B")}
          >
            <Popup className="custom-leaflet-popup">
              <div className="p-1 text-slate-900">
                <div className="flex items-center gap-1.5 font-bold text-xs text-rose-600">
                  <MapPin size={13} />
                  <span>Destination (B)</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-800">
                  {effectiveDestDisplayName}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {formatCoordinate(effectiveDestCoord[0], effectiveDestCoord[1])}
                </p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Floating Controls Overlay */}
      {showControls && (
        <MapControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetView={handleResetView}
          onRecenter={handleRecenter}
          onSelectLandmark={handleSelectLandmark}
          activeTileId={selectedTileId}
          onSelectTileProvider={setSelectedTileId}
          isBoundaryVisible={isBoundaryVisible}
          onToggleBoundary={() => setIsBoundaryVisible(!isBoundaryVisible)}
        />
      )}

      {/* Floating Legend Overlay */}
      {showLegend && (
        <MapLegend
          totalLandmarks={TRICITY_LANDMARKS.length}
          hasActiveRoute={routes.length > 0}
        />
      )}

      {/* Bottom Coordinates & Scope Indicator */}
      <div className="absolute bottom-2 right-4 z-[900] hidden sm:flex items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/80 px-2.5 py-1 text-[10px] font-mono text-slate-400 backdrop-blur-md pointer-events-none">
        <span>Tricity Regional Scope: 35×35 km</span>
        <span className="text-slate-600">|</span>
        <span>Tile: {activeTile.name}</span>
      </div>
    </div>
  );
}
