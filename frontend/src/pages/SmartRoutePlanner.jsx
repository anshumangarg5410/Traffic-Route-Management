import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";
import {
  Navigation,
  Compass,
  MapPin,
  Layers,
  Sparkles,
  Info,
  ChevronRight,
  ArrowUpDown,
  AlertTriangle,
  Route,
  Loader2,
  RotateCcw,
  BarChart3,
  Sliders,
  GitFork,
  Bookmark,
  Check,
  X,
  Clock,
  Cpu,
} from "lucide-react";
import RouteMap from "../components/routing/RouteMap";
import LocationSearchInput from "../components/routing/LocationSearchInput";
import RouteComparisonCard from "../components/routing/RouteComparisonCard";
import RecommendationExplanationPanel from "../components/routing/RecommendationExplanationPanel";
import RouteMetricsDetails from "../components/routing/RouteMetricsDetails";
import IntersectionInspectionPanel from "../components/routing/IntersectionInspectionPanel";
import { getDrivingRoutes, saveRoute, recordRouteHistory } from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  TRICITY_LANDMARKS,
  TRICITY_CENTER,
  formatCoordinate,
  isWithinTricityRegion,
  calculateHaversineDistanceKm,
} from "../components/routing/mapConstants";

function getDefaultDepartureLocalValue() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

/**
 * SmartRoutePlanner Page
 * ======================
 * Phase 10.4: Route Comparison and Recommendation Interface providing:
 * - Multi-criteria route comparison cards with baseline and estimated durations
 * - Recommendation explanation panel with scoring weights and model disclaimer
 * - Detailed signal delay and intersection metrics telemetry
 * - Full two-way selection synchronization between cards and map polylines
 */
export default function SmartRoutePlanner() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  // Map viewport camera state
  const [activeCenter, setActiveCenter] = useState(TRICITY_CENTER);
  const [activeZoom, setActiveZoom] = useState(11);
  const [selectedLandmarkId, setSelectedLandmarkId] = useState(null);

  // Source (Origin A) state
  const [sourceQuery, setSourceQuery] = useState(() => {
    if (location.state?.sourceLocation) {
      return (
        location.state.sourceLocation.displayName ||
        location.state.sourceLocation.name ||
        ""
      );
    }
    return location.state?.sourceQuery || "";
  });

  const [sourceLocation, setSourceLocation] = useState(() => {
    if (location.state?.sourceLocation) {
      const src = location.state.sourceLocation;
      return {
        displayName: src.displayName || src.name || "Origin Point",
        coordinates: src.coordinates,
        address: null,
        sourceType: "saved_route",
      };
    }
    return null;
  });

  // Destination (B) state
  const [destinationQuery, setDestinationQuery] = useState(() => {
    if (location.state?.destinationLocation) {
      return (
        location.state.destinationLocation.displayName ||
        location.state.destinationLocation.name ||
        ""
      );
    }
    return location.state?.destinationQuery || "";
  });

  const [destinationLocation, setDestinationLocation] = useState(() => {
    if (location.state?.destinationLocation) {
      const dst = location.state.destinationLocation;
      return {
        displayName: dst.displayName || dst.name || "Destination Point",
        coordinates: dst.coordinates,
        address: null,
        sourceType: "saved_route",
      };
    }
    return null;
  });

  // Departure date & time for ML temporal traffic context
  const [departureTime, setDepartureTime] = useState(
    () => location.state?.departureTime || getDefaultDepartureLocalValue()
  );

  // Interactive map-click selection mode: 'source' | 'destination' | null
  const [selectionMode, setSelectionMode] = useState(null);
  const [selectionError, setSelectionError] = useState(null);

  // Route generation and comparison state (Phases 10.3, 10.4 & 12)
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [mlPrediction, setMlPrediction] = useState(null);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [routesError, setRoutesError] = useState(null);

  // Detailed Intersection Inspection state (Phase 10.5)
  const [selectedIntersectionNodeId, setSelectedIntersectionNodeId] = useState(null);

  // Details Tab: 'comparison' | 'intersections' | 'explanation' | 'telemetry'
  const [activeDetailsTab, setActiveDetailsTab] = useState("comparison");

  // Saved corridor loaded notification
  const [loadedCorridorTitle, setLoadedCorridorTitle] = useState(
    () => location.state?.title || null
  );

  // Save Route Modal state
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveCriteria, setSaveCriteria] = useState("");
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState(null);

  const routesAbortControllerRef = useRef(null);

  // Invalidate in-flight route requests if component unmounts
  useEffect(() => {
    return () => {
      if (routesAbortControllerRef.current) {
        routesAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Invalidate any previously generated routes whenever endpoints change
  const invalidateRoutes = () => {
    if (routesAbortControllerRef.current) {
      routesAbortControllerRef.current.abort();
    }
    setRoutes([]);
    setSelectedRouteId(null);
    setSelectedIntersectionNodeId(null);
    setRecommendation(null);
    setMlPrediction(null);
    setRoutesError(null);
    setIsLoadingRoutes(false);
    setActiveDetailsTab("comparison");
  };

  // Synchronized route selection: clears active intersection marker from obsolete route
  const handleSelectRoute = (routeId) => {
    setSelectedRouteId(routeId);
    setSelectedIntersectionNodeId(null);
  };

  // Synchronized intersection selection from either list or map marker
  const handleSelectIntersection = (nodeId) => {
    setSelectedIntersectionNodeId(nodeId);
    setActiveDetailsTab("intersections");
  };

  // Calculate straight-line Haversine distance preview when both locations are set
  const straightLineDistanceKm =
    sourceLocation && destinationLocation
      ? calculateHaversineDistanceKm(
          sourceLocation.coordinates,
          destinationLocation.coordinates
        )
      : null;

  // Handle setting active urban landmark
  const handleSelectUrbanCenter = (landmark) => {
    setSelectedLandmarkId(landmark.id);
    setActiveCenter(landmark.coordinates);
    setActiveZoom(landmark.zoom);
  };

  // Quick preset assignment for landmarks
  const handleSetLandmarkAs = (landmark, role) => {
    invalidateRoutes();
    const item = {
      displayName: `${landmark.name} (${landmark.subtitle})`,
      coordinates: landmark.coordinates,
      address: null,
      sourceType: "landmark",
    };

    if (role === "source") {
      setSourceLocation(item);
      setSourceQuery(item.displayName);
      setSelectionError(null);
    } else {
      setDestinationLocation(item);
      setDestinationQuery(item.displayName);
      setSelectionError(null);
    }
  };

  // Swap Source and Destination
  const handleSwapLocations = () => {
    invalidateRoutes();
    const tempQuery = sourceQuery;
    const tempLoc = sourceLocation;

    setSourceQuery(destinationQuery);
    setSourceLocation(destinationLocation);

    setDestinationQuery(tempQuery);
    setDestinationLocation(tempLoc);

    setSelectionError(null);
  };

  // Toggle Map-Click Selection Mode
  const handleToggleMapSelection = (mode) => {
    if (selectionMode === mode) {
      setSelectionMode(null);
    } else {
      setSelectionMode(mode);
      setSelectionError(null);
    }
  };

  // Handle clicks directly on the Leaflet map canvas
  const handleMapClick = (latlon) => {
    if (!selectionMode) return;

    const [lat, lon] = latlon;

    // Strict regional containment validation
    if (!isWithinTricityRegion(lat, lon)) {
      setSelectionError(
        `Selected point (${formatCoordinate(lat, lon)}) is outside the Chandigarh Tricity study area.`
      );
      return;
    }

    invalidateRoutes();
    setSelectionError(null);
    const item = {
      displayName: `Map Point (${formatCoordinate(lat, lon)})`,
      coordinates: [lat, lon],
      address: null,
      sourceType: "map_click",
    };

    if (selectionMode === "source") {
      setSourceLocation(item);
      setSourceQuery(item.displayName);
      setSelectionMode(null);
    } else if (selectionMode === "destination") {
      setDestinationLocation(item);
      setDestinationQuery(item.displayName);
      setSelectionMode(null);
    }
  };

  // Route Generation: Calls POST /routing/routes
  const handleFindRoutes = useCallback(async (overrideSource, overrideDestination) => {
    const src = (overrideSource && overrideSource.coordinates) ? overrideSource : sourceLocation;
    const dst = (overrideDestination && overrideDestination.coordinates) ? overrideDestination : destinationLocation;

    if (!src?.coordinates || !dst?.coordinates) return;

    // Cancel any previous in-flight route fetch
    if (routesAbortControllerRef.current) {
      routesAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    routesAbortControllerRef.current = controller;

    setIsLoadingRoutes(true);
    setRoutesError(null);

    try {
      const payload = {
        source: {
          latitude: src.coordinates[0],
          longitude: src.coordinates[1],
        },
        destination: {
          latitude: dst.coordinates[0],
          longitude: dst.coordinates[1],
        },
        alternatives: true,
        ...(departureTime ? { departure_time: departureTime } : {}),
      };

      const response = await getDrivingRoutes(payload, {
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!response || !Array.isArray(response.routes) || response.routes.length === 0) {
        setRoutes([]);
        setSelectedRouteId(null);
        setRecommendation(null);
        setMlPrediction(response?.ml_traffic_prediction || null);
        setRoutesError("No drivable routes were found between these locations in the road network.");
        return;
      }

      // Preserve complete backend route objects in state
      setRoutes(response.routes);
      setRecommendation(response.recommendation || null);
      setMlPrediction(response.ml_traffic_prediction || null);

      // Authoritative backend recommended route identification
      const recommendedId =
        response.recommendation?.recommended_route_id ||
        response.routes.find((r) => r.is_recommended)?.route_id ||
        null;

      // Default selection to recommended route if present, else first route
      handleSelectRoute(recommendedId || response.routes[0].route_id);
      setActiveDetailsTab("comparison");

      // Record route search history if user is authenticated
      if (isAuthenticated) {
        recordRouteHistory({
          origin_query: src.displayName || sourceQuery || "Origin",
          destination_query: dst.displayName || destinationQuery || "Destination",
          selected_route_id: recommendedId || response.routes[0].route_id,
          route_distance_km: response.routes[0].distance_km,
          estimated_duration_min:
            response.routes[0].signal_delay_summary?.estimated_duration_min ||
            response.routes[0].duration_min,
        }).catch((err) => {
          console.warn("Failed to record route history:", err);
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg =
        err?.message ||
        "Failed to calculate driving routes. Please verify endpoints and try again.";
      setRoutesError(msg);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingRoutes(false);
      }
    }
  }, [sourceLocation, destinationLocation, sourceQuery, destinationQuery, departureTime, isAuthenticated]);

  // Auto-calculate routes if initialized with coordinates from navigation state
  useEffect(() => {
    if (
      location.state?.sourceLocation?.coordinates &&
      location.state?.destinationLocation?.coordinates
    ) {
      const timer = setTimeout(() => {
        handleFindRoutes();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [location.state, handleFindRoutes]);

  // Open Save Corridor Modal
  const handleOpenSaveModal = () => {
    const originName = sourceLocation?.displayName?.split("(")[0]?.trim() || "Origin";
    const destName = destinationLocation?.displayName?.split("(")[0]?.trim() || "Destination";
    setSaveTitle(`${originName} to ${destName}`);
    setSaveCriteria(recommendation?.ranking_method || "weighted_multicriteria");
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);
    setIsSaveModalOpen(true);
  };

  // Submit Save Route Corridor
  const handleSaveRoute = async (e) => {
    e?.preventDefault();
    if (!saveTitle.trim()) {
      setSaveErrorMessage("Please provide a corridor title.");
      return;
    }
    if (!selectedRoute || !sourceLocation || !destinationLocation) {
      setSaveErrorMessage("Missing selected route or location coordinates.");
      return;
    }

    setIsSavingRoute(true);
    setSaveErrorMessage(null);
    try {
      const estDuration =
        typeof selectedRoute.signal_delay_summary?.estimated_duration_min === "number"
          ? selectedRoute.signal_delay_summary.estimated_duration_min
          : selectedRoute.duration_min || null;

      const scoreVal =
        typeof selectedRoute.score === "number"
          ? selectedRoute.score
          : selectedRoute.score_details?.score || null;

      await saveRoute({
        title: saveTitle.trim(),
        origin_name: sourceLocation.displayName,
        origin_lat: sourceLocation.coordinates[0],
        origin_lon: sourceLocation.coordinates[1],
        destination_name: destinationLocation.displayName,
        destination_lat: destinationLocation.coordinates[0],
        destination_lon: destinationLocation.coordinates[1],
        preferred_criteria: saveCriteria.trim() || null,
        distance_km: selectedRoute.distance_km || null,
        estimated_duration_min: estDuration,
        route_score: scoreVal,
        route_geometry: selectedRoute.geometry ? JSON.stringify(selectedRoute.geometry) : null,
        recommendation_reason: selectedRoute.recommendation_reasons?.[0] || null,
      });

      setSaveSuccessMessage("Corridor successfully bookmarked to your saved routes!");
      setTimeout(() => {
        setIsSaveModalOpen(false);
        setSaveSuccessMessage(null);
      }, 1800);
    } catch (err) {
      setSaveErrorMessage(err.message || "Failed to save route corridor.");
    } finally {
      setIsSavingRoute(false);
    }
  };

  // Authoritative recommendation ID from backend response
  const authoritativeRecommendedRouteId =
    recommendation?.recommended_route_id ||
    routes.find((r) => r.is_recommended)?.route_id ||
    null;

  // Selected Route Object
  const selectedRoute =
    routes.find((r) => r.route_id === selectedRouteId) || routes[0] || null;

  // Intersections count for active selected route
  const selectedRouteIntersectionsCount =
    selectedRoute?.intersection_analysis?.total_intersection_nodes ??
    selectedRoute?.intersection_analysis?.matched_intersections?.length ??
    0;

  // Recommended Route Object
  const recommendedRoute =
    routes.find(
      (r) => r.is_recommended || r.route_id === authoritativeRecommendedRouteId
    ) || routes[0] || null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600">
              <Navigation size={22} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Smart Route Planner
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Intelligent location search, multi-criteria route comparison, and modeled signal delay analysis across Chandigarh Tricity.
          </p>
        </div>

        {/* Status Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              {routes.length > 0
                ? `${routes.length} Routes Compared`
                : "Chandigarh Tricity Planner"}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-mono text-blue-400">
            <Compass size={12} />
            <span>Tricity Regional Scope (35×35 km)</span>
          </div>
        </div>
      </div>

      {/* Main Grid Layout: Planning & Comparison Drawer + Interactive Canvas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Side: Planning & Comparison Controls (5 cols for rich card metrics) */}
        <div className="space-y-5 lg:col-span-5">
          {/* Loaded Corridor Banner */}
          {loadedCorridorTitle && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 shadow-sm">
              <div className="flex items-center gap-2">
                <Bookmark size={14} className="text-emerald-600 shrink-0" />
                <span>
                  Loaded corridor: <strong>{loadedCorridorTitle}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLoadedCorridorTitle(null)}
                className="text-emerald-600 hover:text-emerald-200 transition"
                aria-label="Dismiss loaded corridor notification"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Journey Origin & Destination Input Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-400">
                  <MapPin size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Journey Locations
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Search address or click on map
                  </p>
                </div>
              </div>

              {/* Swap Button */}
              <button
                type="button"
                onClick={handleSwapLocations}
                disabled={!sourceLocation && !destinationLocation}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                title="Swap Origin and Destination"
              >
                <ArrowUpDown size={13} className="text-blue-400" />
                <span>Swap</span>
              </button>
            </div>

            <div className="space-y-3">
              {/* Origin (Source A) Input */}
              <LocationSearchInput
                label="Origin / Source"
                badgeLetter="A"
                badgeColor="emerald"
                query={sourceQuery}
                selectedLocation={sourceLocation}
                onChangeQuery={(val) => {
                  setSourceQuery(val);
                  invalidateRoutes();
                }}
                onSelectLocation={(loc) => {
                  setSourceLocation(loc);
                  setSelectionError(null);
                  invalidateRoutes();
                }}
                onClearLocation={() => {
                  setSourceLocation(null);
                  setSelectionError(null);
                  invalidateRoutes();
                }}
                onPickOnMap={() => handleToggleMapSelection("source")}
                isMapPicking={selectionMode === "source"}
                placeholder="Search origin address, sector, or landmark..."
              />

              {/* Destination (B) Input */}
              <LocationSearchInput
                label="Destination"
                badgeLetter="B"
                badgeColor="rose"
                query={destinationQuery}
                selectedLocation={destinationLocation}
                onChangeQuery={(val) => {
                  setDestinationQuery(val);
                  invalidateRoutes();
                }}
                onSelectLocation={(loc) => {
                  setDestinationLocation(loc);
                  setSelectionError(null);
                  invalidateRoutes();
                }}
                onClearLocation={() => {
                  setDestinationLocation(null);
                  setSelectionError(null);
                  invalidateRoutes();
                }}
                onPickOnMap={() => handleToggleMapSelection("destination")}
                isMapPicking={selectionMode === "destination"}
                placeholder="Search destination address, sector, or landmark..."
              />

              {/* Departure Date & Time Input */}
              <div className="space-y-1.5 pt-1">
                <label
                  htmlFor="planner-departure-time"
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                    <Clock size={12} className="text-cyan-400" />
                    <span>Departure Date & Time</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Used for ML traffic context
                  </span>
                </label>
                <input
                  id="planner-departure-time"
                  type="datetime-local"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>
            </div>

            {/* Geographic Selection Error Notice */}
            {selectionError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                <p>{selectionError}</p>
              </div>
            )}

            {/* Route Generation Failure Alert */}
            {routesError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-400" />
                <div className="flex-1">
                  <p className="font-semibold text-rose-200">Route Generation Issue</p>
                  <p className="mt-0.5">{routesError}</p>
                  <button
                    type="button"
                    onClick={handleFindRoutes}
                    disabled={isLoadingRoutes || !sourceLocation || !destinationLocation}
                    className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-600/30 border border-rose-500/40 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-600/50 transition focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none disabled:opacity-50"
                  >
                    <RotateCcw size={12} className={isLoadingRoutes ? "animate-spin" : ""} />
                    <span>Retry Search</span>
                  </button>
                </div>
              </div>
            )}

            {/* Active Selection Summary Card */}
            {(sourceLocation || destinationLocation) && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                  <span>Selection Overview</span>
                  {sourceLocation && destinationLocation && (
                    <span className="text-emerald-600 font-mono lowercase">
                      ~{straightLineDistanceKm} km straight-line
                    </span>
                  )}
                </div>

                {sourceLocation && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-600">
                      A
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">
                        {sourceLocation.displayName}
                      </p>
                      <p className="font-mono text-[10px] text-slate-500">
                        {formatCoordinate(
                          sourceLocation.coordinates[0],
                          sourceLocation.coordinates[1]
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {destinationLocation && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-[10px] font-bold text-rose-400">
                      B
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">
                        {destinationLocation.displayName}
                      </p>
                      <p className="font-mono text-[10px] text-slate-500">
                        {formatCoordinate(
                          destinationLocation.coordinates[0],
                          destinationLocation.coordinates[1]
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {/* Find Driving Routes Action Button */}
                <div className="pt-2 border-t border-slate-200 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleFindRoutes()}
                    disabled={
                      !sourceLocation || !destinationLocation || isLoadingRoutes
                    }
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none"
                  >
                    {isLoadingRoutes ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-blue-200" />
                        <span>Generating Driving Routes...</span>
                      </>
                    ) : (
                      <>
                        <Route size={14} />
                        <span>{routes.length > 0 ? "Recalculate Routes" : "Find Driving Routes"}</span>
                      </>
                    )}
                  </button>
                  {routes.length > 0 && (
                    <button
                      type="button"
                      onClick={invalidateRoutes}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
                      title="Clear route calculations"
                      aria-label="Clear calculated routes"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Phase 10.4: Multi-Route Comparison & Explanation Interface */}
          {routes.length > 0 && (
            <div className="space-y-4">
              {/* Save Corridor Action Bar */}
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <Bookmark size={15} className="text-emerald-600" />
                  <span className="text-xs font-medium text-slate-700">
                    {selectedRoute
                      ? `Selected Route ${selectedRoute.rank || selectedRoute.route_id}`
                      : "Route Calculated"}
                  </span>
                </div>
                {isAuthenticated ? (
                  <button
                    type="button"
                    onClick={handleOpenSaveModal}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20"
                  >
                    <Bookmark size={13} />
                    <span>Save Corridor</span>
                  </button>
                ) : (
                  <Link
                    to="/login"
                    className="text-xs text-slate-600 underline decoration-slate-600 transition hover:text-emerald-600"
                    title="Sign in to save this corridor"
                  >
                    Sign in to bookmark
                  </Link>
                )}
              </div>

              {/* ML Departure Traffic Context Banner */}
              {mlPrediction && (
                <div
                  className={`rounded-xl border p-3.5 text-xs ${
                    mlPrediction.status === "available"
                      ? mlPrediction.predicted_traffic_level === "High"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                        : mlPrediction.predicted_traffic_level === "Medium"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <Cpu size={14} className="shrink-0" />
                      <span>
                        {mlPrediction.status === "available"
                          ? `Predicted Departure Traffic: ${mlPrediction.predicted_traffic_level}`
                          : "ML Traffic Prediction Unavailable"}
                      </span>
                    </div>
                    {mlPrediction.status === "available" &&
                      mlPrediction.confidence &&
                      mlPrediction.predicted_traffic_level &&
                      typeof mlPrediction.confidence[mlPrediction.predicted_traffic_level] === "number" && (
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 font-mono text-[10px]">
                          {(
                            mlPrediction.confidence[mlPrediction.predicted_traffic_level] * 100
                          ).toFixed(0)}
                          % conf.
                        </span>
                      )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed opacity-90">
                    {mlPrediction.status === "available"
                      ? mlPrediction.provenance_note
                      : mlPrediction.error_message ||
                        "Showing OSRM baseline and mapped signal-delay route rankings."}
                  </p>
                  {mlPrediction.status === "available" && (
                    <p className="mt-1 text-[10px] opacity-75">
                      {mlPrediction.limitation_note}
                    </p>
                  )}
                </div>
              )}

              {/* Tab Navigation Controller */}
              <div
                role="tablist"
                aria-label="Route analysis tabs"
                className="flex flex-wrap items-center justify-between gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 backdrop-blur-sm"
              >
                <button
                  type="button"
                  role="tab"
                  id="tab-comparison"
                  aria-selected={activeDetailsTab === "comparison"}
                  aria-controls="tabpanel-comparison"
                  onClick={() => setActiveDetailsTab("comparison")}
                  className={`flex flex-1 min-w-[70px] items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none ${
                    activeDetailsTab === "comparison"
                      ? "bg-slate-100 text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  <BarChart3 size={13} className="text-cyan-400 shrink-0" />
                  <span>Compare ({routes.length})</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  id="tab-intersections"
                  aria-selected={activeDetailsTab === "intersections"}
                  aria-controls="tabpanel-intersections"
                  onClick={() => setActiveDetailsTab("intersections")}
                  className={`flex flex-1 min-w-[70px] items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${
                    activeDetailsTab === "intersections"
                      ? "bg-slate-100 text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  <GitFork size={13} className="text-amber-600 shrink-0" />
                  <span>Nodes ({selectedRouteIntersectionsCount})</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  id="tab-explanation"
                  aria-selected={activeDetailsTab === "explanation"}
                  aria-controls="tabpanel-explanation"
                  onClick={() => setActiveDetailsTab("explanation")}
                  className={`flex flex-1 min-w-[70px] items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none ${
                    activeDetailsTab === "explanation"
                      ? "bg-slate-100 text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  <Sparkles size={13} className="text-emerald-600 shrink-0" />
                  <span>Rank Analysis</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  id="tab-telemetry"
                  aria-selected={activeDetailsTab === "telemetry"}
                  aria-controls="tabpanel-telemetry"
                  onClick={() => setActiveDetailsTab("telemetry")}
                  className={`flex flex-1 min-w-[70px] items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none ${
                    activeDetailsTab === "telemetry"
                      ? "bg-slate-100 text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  <Sliders size={13} className="text-purple-400 shrink-0" />
                  <span>Telemetry</span>
                </button>

                <button
                  type="button"
                  onClick={invalidateRoutes}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
                  title="Reset and clear routes"
                  aria-label="Reset and clear routes"
                >
                  <RotateCcw size={13} />
                </button>
              </div>

              {/* Tab 1: Route Comparison Cards List */}
              {activeDetailsTab === "comparison" && (
                <div
                  role="tabpanel"
                  id="tabpanel-comparison"
                  aria-labelledby="tab-comparison"
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between px-1">
                    <p className="text-xs font-semibold text-slate-700">
                      Ranked Driving Alternatives ({routes.length} Found)
                    </p>
                    <span className="text-[11px] text-slate-500">
                      Click to highlight on map
                    </span>
                  </div>

                  <div className="space-y-3">
                    {routes.map((route) => {
                      const isRec =
                        route.is_recommended ||
                        route.route_id === authoritativeRecommendedRouteId;
                      const isSel = route.route_id === selectedRouteId;

                      return (
                        <RouteComparisonCard
                          key={route.route_id}
                          route={route}
                          isSelected={isSel}
                          isRecommended={isRec}
                          mlPrediction={mlPrediction}
                          onSelect={(id) => handleSelectRoute(id)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tab 2: Detailed Intersection Inspection Panel (Phase 10.5) */}
              {activeDetailsTab === "intersections" && (
                <div
                  role="tabpanel"
                  id="tabpanel-intersections"
                  aria-labelledby="tab-intersections"
                >
                  <IntersectionInspectionPanel
                    route={selectedRoute}
                    selectedIntersectionNodeId={selectedIntersectionNodeId}
                    onSelectIntersection={handleSelectIntersection}
                  />
                </div>
              )}

              {/* Tab 3: Recommendation Explanation Panel */}
              {activeDetailsTab === "explanation" && (
                <div
                  role="tabpanel"
                  id="tabpanel-explanation"
                  aria-labelledby="tab-explanation"
                >
                  <RecommendationExplanationPanel
                    recommendation={recommendation}
                    recommendedRoute={recommendedRoute}
                    mlPrediction={mlPrediction}
                  />
                </div>
              )}

              {/* Tab 4: Detailed Telemetry for Selected Route */}
              {activeDetailsTab === "telemetry" && (
                <div
                  role="tabpanel"
                  id="tabpanel-telemetry"
                  aria-labelledby="tab-telemetry"
                >
                  <RouteMetricsDetails route={selectedRoute} />
                </div>
              )}
            </div>
          )}

          {/* Quick-Jump Urban Centers */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass size={16} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Tricity Urban Centers
                </h3>
              </div>
              <span className="text-[11px] text-slate-500">
                {TRICITY_LANDMARKS.length} Key Hubs
              </span>
            </div>

            <p className="mb-3 text-xs text-slate-600">
              Select any regional center to pan, or quickly set as Origin or Destination:
            </p>

            <div className="space-y-2">
              {TRICITY_LANDMARKS.map((landmark) => {
                const isSelected = selectedLandmarkId === landmark.id;
                return (
                  <div
                    key={landmark.id}
                    className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                      isSelected
                        ? "border-purple-500/50 bg-purple-500/10 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectUrbanCenter(landmark)}
                      className="flex items-start gap-2 text-left min-w-0 flex-1"
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          isSelected
                            ? "bg-purple-500 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <MapPin size={11} />
                      </span>
                      <div className="truncate">
                        <p className="text-xs font-semibold leading-tight truncate">
                          {landmark.name}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500 truncate">
                          {landmark.subtitle}
                        </p>
                      </div>
                    </button>

                    {/* Quick Assignment Pills */}
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => handleSetLandmarkAs(landmark, "source")}
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-500/20"
                        title={`Set ${landmark.name} as Origin (A)`}
                      >
                        +A
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetLandmarkAs(landmark, "dest")}
                        className="rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400 hover:bg-rose-500/20"
                        title={`Set ${landmark.name} as Destination (B)`}
                      >
                        +B
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectUrbanCenter(landmark)}
                        className="p-1 text-slate-500 hover:text-slate-700"
                        title="Focus on map"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Regional Road Network Metrics */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop-blur-sm">
            <div className="mb-3 flex items-center gap-2">
              <Layers size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900">
                Underlying Road Graph
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-lg font-bold font-mono text-slate-900">56,254</p>
                <p className="text-[11px] text-slate-500">OSM Graph Nodes</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-lg font-bold font-mono text-slate-900">144,015</p>
                <p className="text-[11px] text-slate-500">Directed Edges</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-lg font-bold font-mono text-slate-900">13,093 km</p>
                <p className="text-[11px] text-slate-500">Drivable Roads</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-lg font-bold font-mono text-slate-900">26</p>
                <p className="text-[11px] text-slate-500">Mapped Signals</p>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50/40 p-2.5 text-[11px] text-slate-600">
              <Info size={14} className="mt-0.5 shrink-0 text-blue-400" />
              <span>
                Road network extracted and validated across Chandigarh, Mohali, Panchkula, Zirakpur, Kharar, New Chandigarh, and Dera Bassi.
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Interactive Geographical RouteMap Canvas (7 cols) */}
        <div className="flex flex-col lg:col-span-7 min-h-[580px]">
          <RouteMap
            className="flex-1"
            initialCenter={activeCenter}
            initialZoom={activeZoom}
            source={sourceLocation}
            destination={destinationLocation}
            routes={routes}
            selectedRouteId={selectedRouteId}
            recommendedRouteId={authoritativeRecommendedRouteId}
            onRouteSelect={handleSelectRoute}
            selectedIntersectionNodeId={selectedIntersectionNodeId}
            onIntersectionSelect={handleSelectIntersection}
            selectionMode={selectionMode}
            onCancelSelectionMode={() => setSelectionMode(null)}
            onMapClick={handleMapClick}
            showControls={true}
            showLegend={true}
            showBoundary={true}
            showLandmarks={true}
          />
        </div>
      </div>

      {/* Save Route Corridor Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                  <Bookmark size={20} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Save Route Corridor</h3>
                  <p className="text-xs text-slate-600">Bookmark route telemetry to your workspace</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRoute} className="mt-4 space-y-4">
              {/* Route Telemetry Preview Card */}
              {selectedRoute && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Rank & Corridor</span>
                    <span className="font-semibold text-slate-900">
                      Route {selectedRoute.rank || selectedRoute.route_id}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-slate-200/60 pt-2 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Distance</p>
                      <p className="font-semibold text-slate-800">
                        {selectedRoute.distance_km ? `${selectedRoute.distance_km.toFixed(1)} km` : "--"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Est. Duration</p>
                      <p className="font-semibold text-emerald-600">
                        {selectedRoute.signal_delay_summary?.estimated_duration_min
                          ? `${selectedRoute.signal_delay_summary.estimated_duration_min.toFixed(0)} min`
                          : selectedRoute.duration_min
                          ? `${selectedRoute.duration_min.toFixed(0)} min`
                          : "--"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Score</p>
                      <p className="font-semibold text-cyan-400">
                        {typeof selectedRoute.score === "number" ? selectedRoute.score.toFixed(1) : "--"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Title Input */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Corridor Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="e.g. Sector 17 to IT Park via Madhya Marg"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Preferred Criteria Input */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Preferences / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={saveCriteria}
                  onChange={(e) => setSaveCriteria(e.target.value)}
                  placeholder="e.g. Avoid peak signal delay"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Success Notification */}
              {saveSuccessMessage && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600">
                  <Check size={16} className="shrink-0" />
                  <span>{saveSuccessMessage}</span>
                </div>
              )}

              {/* Error Notification */}
              {saveErrorMessage && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{saveErrorMessage}</span>
                </div>
              )}

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  disabled={isSavingRoute}
                  className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingRoute || Boolean(saveSuccessMessage)}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-400 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                >
                  {isSavingRoute ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Saving Corridor...</span>
                    </>
                  ) : saveSuccessMessage ? (
                    <>
                      <Check size={14} />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <>
                      <Bookmark size={14} />
                      <span>Bookmark Corridor</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
