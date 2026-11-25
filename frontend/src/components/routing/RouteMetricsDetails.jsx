import {
  Clock,
  MapPin,
  AlertCircle,
  Compass,
} from "lucide-react";

/**
 * RouteMetricsDetails Component
 * =============================
 * Phase 10.4: Detailed inspection telemetry for the currently selected route:
 * - Direct comparison of baseline free-flow vs. signal-delayed duration
 * - Signal count and cumulative estimated delay
 * - Topological intersection node count and density per km
 * - Transparent unavailable status for missing metrics
 */
export default function RouteMetricsDetails({ route }) {
  if (!route) return null;

  const isRecommended = Boolean(route.is_recommended);
  const summary = route.summary || `Route ${route.rank || route.route_id}`;

  // Durations
  const baselineDurationMin =
    typeof route.duration_min === "number"
      ? route.duration_min
      : typeof route.duration_s === "number"
      ? route.duration_s / 60.0
      : null;

  const signalSummary = route.signal_delay_summary;
  const hasSignalDelay =
    signalSummary != null &&
    signalSummary.analysis_status !== "missing_intersection_analysis" &&
    signalSummary.analysis_status !== "error";

  const estimatedDurationMin = hasSignalDelay
    ? typeof signalSummary.estimated_duration_min === "number"
      ? signalSummary.estimated_duration_min
      : signalSummary.estimated_duration_s
      ? signalSummary.estimated_duration_s / 60.0
      : null
    : null;

  const signalDelayS = hasSignalDelay
    ? typeof signalSummary.total_estimated_signal_delay_s === "number"
      ? signalSummary.total_estimated_signal_delay_s
      : null
    : null;

  const signalCount = hasSignalDelay
    ? typeof signalSummary.signal_count === "number"
      ? signalSummary.signal_count
      : null
    : route.intersection_analysis?.signalized_intersection_nodes != null
    ? route.intersection_analysis.signalized_intersection_nodes
    : null;

  // Intersections
  const intersectionAnalysis = route.intersection_analysis;
  const hasIntersectionAnalysis =
    intersectionAnalysis != null &&
    intersectionAnalysis.analysis_status !== "invalid_geometry" &&
    intersectionAnalysis.analysis_status !== "graph_unavailable";

  const totalIntersections = hasIntersectionAnalysis
    ? typeof intersectionAnalysis.total_intersection_nodes === "number"
      ? intersectionAnalysis.total_intersection_nodes
      : null
    : null;

  const unsignalizedIntersections = hasIntersectionAnalysis
    ? typeof intersectionAnalysis.unsignalized_intersection_nodes === "number"
      ? intersectionAnalysis.unsignalized_intersection_nodes
      : null
    : null;

  const intersectionDensity = hasIntersectionAnalysis
    ? typeof intersectionAnalysis.intersection_density_per_km === "number"
      ? intersectionAnalysis.intersection_density_per_km
      : null
    : null;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                isRecommended
                  ? "bg-emerald-500 text-white"
                  : "bg-cyan-500 text-white"
              }`}
            >
              {route.rank || "#"}
            </span>
            <h4 className="text-sm font-semibold text-white truncate">
              {summary} (Selected Telemetry)
            </h4>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Detailed intersection & signal delay breakdown
          </p>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-slate-400 uppercase font-semibold">
            Distance
          </span>
          <p className="text-sm font-bold text-white font-mono">
            {route.distance_km != null ? `${route.distance_km} km` : "N/A"}
          </p>
        </div>
      </div>

      {/* Duration Comparison Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2">
        <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Clock size={13} className="text-blue-400" />
          <span>Travel Time Breakdown</span>
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400">Baseline (OSRM Free-Flow)</span>
            <p className="text-sm font-bold text-slate-200 font-mono">
              {baselineDurationMin != null ? `${baselineDurationMin.toFixed(1)} min` : "Unavailable"}
            </p>
            <p className="text-[10px] text-slate-500">Nominal speed, zero delay</p>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-slate-400">Estimated (with Signals)</span>
            <p className="text-base font-bold text-emerald-400 font-mono">
              {estimatedDurationMin != null ? `${estimatedDurationMin.toFixed(1)} min` : "Unavailable"}
            </p>
            <p className="text-[10px] text-slate-500">
              {signalDelayS != null ? `+${Math.round(signalDelayS)}s modeled delay` : "Delay not modeled"}
            </p>
          </div>
        </div>
      </div>

      {/* Intersection Telemetry Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px]">Mapped Signals</span>
            <span className="text-xs">🚦</span>
          </div>
          <p className="text-lg font-bold text-white font-mono">
            {signalCount != null ? signalCount : "Unavailable"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Tagged in OpenStreetMap
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px]">Signal Delay</span>
            <Clock size={12} className="text-blue-400" />
          </div>
          <p className="text-lg font-bold text-white font-mono">
            {signalDelayS != null ? `${Math.round(signalDelayS)}s` : "Unavailable"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {signalDelayS != null ? `~${(signalDelayS / 60.0).toFixed(1)} min modeled` : "N/A"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px]">Total Intersections</span>
            <MapPin size={12} className="text-purple-400" />
          </div>
          <p className="text-lg font-bold text-white font-mono">
            {totalIntersections != null ? totalIntersections : "Unavailable"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Physical degree ≥ 3 nodes
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px]">Intersection Density</span>
            <Compass size={12} className="text-amber-400" />
          </div>
          <p className="text-lg font-bold text-white font-mono">
            {intersectionDensity != null ? `${intersectionDensity.toFixed(2)}` : "Unavailable"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Intersections per km
          </p>
        </div>
      </div>

      {/* Non-Signal-Tagged Intersections Notice */}
      {unsignalizedIntersections != null && (
        <div className="flex items-center justify-between rounded-xl bg-slate-950/40 p-2.5 text-xs border border-slate-800/60 text-slate-400">
          <span>Topological Intersections (No Mapped Signal Tag):</span>
          <span className="font-mono font-semibold text-slate-200">
            {unsignalizedIntersections} nodes
          </span>
        </div>
      )}

      {/* Engineering Disclaimer */}
      <div className="flex items-start gap-2 rounded-xl bg-slate-950/50 p-2.5 text-[10px] text-slate-400 border border-slate-800/60 leading-relaxed">
        <AlertCircle size={13} className="shrink-0 mt-0.5 text-slate-500" />
        <span>
          Signal delays are modeled using uniform-random-arrival formulation (d = R² / 2C) with baseline uncalibrated cycle C = 90.0s and effective red R = 60.0s (~20.0s delay per signal). Absence of an OSM signal tag does not establish the absence of a physical signal; individual delay is not modeled for intersections without mapped signal data.
        </span>
      </div>
    </div>
  );
}
