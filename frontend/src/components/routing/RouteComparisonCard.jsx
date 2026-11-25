import {
  CheckCircle2,
  Clock,
  MapPin,
  TrendingUp,
  AlertCircle,
  Sparkles,
} from "lucide-react";

/**
 * RouteComparisonCard Component
 * =============================
 * Phase 10.4: Multi-criteria route comparison card displaying:
 * - Route rank and corridor name/summary
 * - Free-flow baseline duration vs estimated duration (incl. modeled signal delays)
 * - Road distance in kilometers
 * - Mapped traffic signals and estimated delay
 * - Total topological intersections and density per kilometer
 * - Composite multi-criteria score
 * - Authoritative backend recommendation badge and reasons
 */
export default function RouteComparisonCard({
  route,
  isSelected = false,
  isRecommended = false,
  mlPrediction = null,
  onSelect,
}) {
  if (!route) return null;

  // 1. Metric Extractions (Preserving exact backend fields without inventing or falsifying zeros)
  const rank = route.rank;
  const score = typeof route.score === "number" ? route.score : route.score_details?.score;
  const summary = route.summary || `Route ${rank || route.route_id}`;
  const distanceKm = typeof route.distance_km === "number" ? route.distance_km : null;

  // Baseline duration (OSRM nominal free-flow estimate)
  const baselineDurationMin =
    typeof route.duration_min === "number"
      ? route.duration_min
      : typeof route.duration_s === "number"
      ? route.duration_s / 60.0
      : null;

  // Signal delay summary
  const signalSummary = route.signal_delay_summary;
  const hasSignalDelay =
    signalSummary !== null &&
    signalSummary !== undefined &&
    signalSummary.analysis_status !== "missing_intersection_analysis" &&
    signalSummary.analysis_status !== "error";

  // Estimated duration (Baseline + modeled signal delay)
  const estimatedDurationMin = hasSignalDelay
    ? typeof signalSummary.estimated_duration_min === "number"
      ? signalSummary.estimated_duration_min
      : signalSummary.estimated_duration_s
      ? signalSummary.estimated_duration_s / 60.0
      : null
    : null;

  // Estimated signal delay in seconds and minutes
  const totalSignalDelayS = hasSignalDelay
    ? typeof signalSummary.total_estimated_signal_delay_s === "number"
      ? signalSummary.total_estimated_signal_delay_s
      : null
    : null;

  // Traffic signal count
  const signalCount = hasSignalDelay
    ? typeof signalSummary.signal_count === "number"
      ? signalSummary.signal_count
      : null
    : route.intersection_analysis?.signalized_intersection_nodes != null
    ? route.intersection_analysis.signalized_intersection_nodes
    : null;

  // Topological intersection analysis
  const intersectionAnalysis = route.intersection_analysis;
  const hasIntersectionAnalysis =
    intersectionAnalysis !== null &&
    intersectionAnalysis !== undefined &&
    intersectionAnalysis.analysis_status !== "invalid_geometry" &&
    intersectionAnalysis.analysis_status !== "graph_unavailable";

  const totalIntersections = hasIntersectionAnalysis
    ? typeof intersectionAnalysis.total_intersection_nodes === "number"
      ? intersectionAnalysis.total_intersection_nodes
      : null
    : null;

  const intersectionDensity = hasIntersectionAnalysis
    ? typeof intersectionAnalysis.intersection_density_per_km === "number"
      ? intersectionAnalysis.intersection_density_per_km
      : null
    : null;

  const recommendationReasons = Array.isArray(route.recommendation_reasons)
    ? route.recommendation_reasons
    : [];

  // Card Border and Background Styling based on visual state
  const containerClasses = isSelected
    ? isRecommended
      ? "border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/40"
      : "border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/40"
    : isRecommended
    ? "border-emerald-500/50 bg-slate-900/90 hover:border-emerald-500/80 hover:bg-slate-800/80"
    : "border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900/70";

  return (
    <div
      onClick={() => onSelect?.(route.route_id)}
      className={`relative cursor-pointer rounded-2xl border p-4.5 transition-all ${containerClasses}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(route.route_id);
        }
      }}
    >
      {/* Header: Rank, Corridor Name, Badges */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isRecommended
                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/50"
                : isSelected
                ? "bg-cyan-500 text-white shadow-sm shadow-cyan-500/50"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            {rank || "#"}
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white truncate leading-tight">
              {summary}
            </h4>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              ID: {route.route_id}
            </p>
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isRecommended && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
              <Sparkles size={10} />
              <span>Recommended</span>
            </span>
          )}
          {isSelected && (
            <span className="rounded-full bg-cyan-500/20 border border-cyan-500/40 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
              Active on Map
            </span>
          )}
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/60 p-3 text-xs mb-3 border border-slate-800/80">
        {/* Estimated Duration */}
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
            <Clock size={11} className="text-blue-400" />
            <span>Est. Journey Time</span>
          </p>
          <p className="text-base font-bold text-white font-mono">
            {estimatedDurationMin != null ? `${estimatedDurationMin.toFixed(1)} min` : "Unavailable"}
          </p>
          <p className="text-[9px] text-slate-500">
            {totalSignalDelayS != null
              ? `(incl. +${Math.round(totalSignalDelayS)}s signal delay)`
              : "Modeled delay unavailable"}
          </p>
        </div>

        {/* Baseline Free-Flow Duration */}
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
            <TrendingUp size={11} className="text-slate-400" />
            <span>Baseline Free-Flow</span>
          </p>
          <p className="text-sm font-semibold text-slate-300 font-mono">
            {baselineDurationMin != null ? `${baselineDurationMin.toFixed(1)} min` : "Unavailable"}
          </p>
          <p className="text-[9px] text-slate-500">Nominal OSRM speed</p>
        </div>

        {/* Distance */}
        <div className="space-y-0.5 pt-1.5 border-t border-slate-800/60">
          <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
            <MapPin size={11} className="text-purple-400" />
            <span>Route Distance</span>
          </p>
          <p className="text-sm font-semibold text-white font-mono">
            {distanceKm != null ? `${distanceKm.toFixed(1)} km` : "Unavailable"}
          </p>
        </div>

        {/* Route Score */}
        <div className="space-y-0.5 pt-1.5 border-t border-slate-800/60">
          <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
            <Sparkles size={11} className="text-amber-400" />
            <span>Composite Score</span>
          </p>
          <p className="text-sm font-semibold text-amber-300 font-mono">
            {score != null ? `${(score * 100).toFixed(1)} / 100` : "Not Scored"}
          </p>
        </div>
      </div>

      {/* Secondary Metrics: Signals & Intersections */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-900/60 p-2 text-center text-xs mb-3 border border-slate-800/50">
        <div>
          <p className="text-[10px] text-slate-400">Mapped Signals</p>
          <p className="font-mono font-semibold text-white mt-0.5">
            {signalCount != null ? signalCount : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-400">Intersections</p>
          <p className="font-mono font-semibold text-white mt-0.5">
            {totalIntersections != null ? totalIntersections : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-400">Density</p>
          <p className="font-mono font-semibold text-white mt-0.5">
            {intersectionDensity != null ? `${intersectionDensity.toFixed(2)}/km` : "N/A"}
          </p>
        </div>
      </div>

      {/* ML Temporal Traffic Context (shared across departure time) */}
      {mlPrediction?.status === "available" && mlPrediction.predicted_traffic_level && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-1.5 text-[11px]">
          <span className="text-slate-400">Departure Traffic Context (ML):</span>
          <span
            className={`font-semibold ${
              mlPrediction.predicted_traffic_level === "High"
                ? "text-rose-400"
                : mlPrediction.predicted_traffic_level === "Medium"
                ? "text-amber-400"
                : "text-emerald-400"
            }`}
          >
            {mlPrediction.predicted_traffic_level}
          </span>
        </div>
      )}

      {/* Recommendation Reasons / Alternative Trade-Offs */}
      {recommendationReasons.length > 0 && (
        <div className="space-y-1 mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {isRecommended ? "Recommendation Factors" : "Comparative Trade-offs"}
          </p>
          <ul className="space-y-1 text-xs">
            {recommendationReasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-1.5 text-slate-300 text-[11px] leading-tight">
                <CheckCircle2
                  size={12}
                  className={`mt-0.5 shrink-0 ${
                    isRecommended ? "text-emerald-400" : "text-slate-400"
                  }`}
                />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Data Notice if metrics were missing or imputed */}
      {(!hasSignalDelay || !hasIntersectionAnalysis) && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-400">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>
            Intersection or signal metrics were partially unavailable for this candidate route.
          </span>
        </div>
      )}

      {/* Select Action Footer */}
      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs">
        <span className="text-[11px] text-slate-500">
          {isSelected ? "Currently highlighted on map" : "Click card to highlight route"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(route.route_id);
          }}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
            isSelected
              ? "bg-cyan-500 text-white shadow-sm shadow-cyan-500/20"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          {isSelected ? "Selected" : "Select Route"}
        </button>
      </div>
    </div>
  );
}
