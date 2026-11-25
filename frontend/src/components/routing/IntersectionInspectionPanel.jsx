import { useState, useMemo } from "react";
import {
  GitFork,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  ChevronRight,
  Search,
  Filter,
  Copy,
  Check,
} from "lucide-react";
import { formatCoordinate } from "./mapConstants";

/**
 * IntersectionInspectionPanel Component
 * =====================================
 * Phase 10.5: Detailed Intersection Inspection
 * Displays all intersections encountered along the currently selected driving route:
 * - Sequence number in order of route progression (sorted by cumulative distance)
 * - OpenStreetMap Node ID (stable identifier)
 * - Classification: Mapped Traffic Signal vs. Other Topological Intersection
 * - Distance from route origin (meters/km) and lateral distance offset
 * - Geographic coordinates (latitude, longitude)
 * - Per-signal delay metrics (cycle, effective red time, estimated uniform delay)
 * - Full two-way selection synchronization with map markers
 * - Transparent methodological disclaimers regarding OSM incompleteness and heuristic modeling
 */
export default function IntersectionInspectionPanel({
  route,
  selectedIntersectionNodeId = null,
  onSelectIntersection = null,
}) {
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'signalized' | 'unsignalized'
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedNodeId, setCopiedNodeId] = useState(null);

  // Copy OSM Node ID helper
  const handleCopyNodeId = (e, nodeId) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(String(nodeId));
    setCopiedNodeId(nodeId);
    setTimeout(() => setCopiedNodeId(null), 1500);
  };

  // Extract raw intersections and per-signal delay metrics from route response
  const {
    intersectionsList,
    totalCount,
    signalCount,
    unsignalCount,
    densityPerKm,
    analysisStatus,
    analysisWarnings,
  } = useMemo(() => {
    if (!route || !route.intersection_analysis) {
      return {
        intersectionsList: [],
        totalCount: 0,
        signalCount: 0,
        unsignalCount: 0,
        densityPerKm: null,
        analysisStatus: "missing",
        analysisWarnings: [],
      };
    }

    const analysis = route.intersection_analysis;
    const rawMatches = Array.isArray(analysis.matched_intersections)
      ? analysis.matched_intersections
      : [];

    // Map per-signal delay records by osm_node_id
    const signalDelays = Array.isArray(route.signal_delay_summary?.signal_delays)
      ? route.signal_delay_summary.signal_delays
      : [];
    const signalDelayMap = new Map();
    for (const sd of signalDelays) {
      if (sd && sd.osm_node_id != null) {
        signalDelayMap.set(String(sd.osm_node_id), sd);
      }
    }

    // Filter valid coordinate nodes and deduplicate by osm_node_id if necessary
    const seenNodeIds = new Set();
    const enriched = [];

    for (const item of rawMatches) {
      if (!item || item.osm_node_id == null) continue;
      const lat = typeof item.latitude === "number" ? item.latitude : null;
      const lon = typeof item.longitude === "number" ? item.longitude : null;
      if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) continue;

      const nodeIdStr = String(item.osm_node_id);
      // Keep only first occurrence if duplicate
      if (seenNodeIds.has(nodeIdStr)) continue;
      seenNodeIds.add(nodeIdStr);

      const isSignalized = Boolean(item.is_signalized);
      const signalDelay = isSignalized ? signalDelayMap.get(nodeIdStr) || null : null;

      enriched.push({
        osm_node_id: item.osm_node_id,
        latitude: lat,
        longitude: lon,
        distance_along_route_m:
          typeof item.distance_along_route_m === "number" && !Number.isNaN(item.distance_along_route_m)
            ? item.distance_along_route_m
            : 0,
        distance_from_route_m:
          typeof item.distance_from_route_m === "number" && !Number.isNaN(item.distance_from_route_m)
            ? item.distance_from_route_m
            : 0,
        is_signalized: isSignalized,
        signal_tags: item.signal_tags || null,
        signal_delay: signalDelay,
      });
    }

    // Sort strictly by cumulative distance along route
    enriched.sort((a, b) => a.distance_along_route_m - b.distance_along_route_m);

    // Assign 1-based sequential progression number
    const sequenced = enriched.map((item, idx) => ({
      ...item,
      seq: idx + 1,
    }));

    const computedSignalCount = sequenced.filter((i) => i.is_signalized).length;
    const computedUnsignalCount = sequenced.length - computedSignalCount;

    return {
      intersectionsList: sequenced,
      totalCount: sequenced.length,
      signalCount: computedSignalCount,
      unsignalCount: computedUnsignalCount,
      densityPerKm:
        typeof analysis.intersection_density_per_km === "number"
          ? analysis.intersection_density_per_km
          : null,
      analysisStatus: analysis.analysis_status || "success",
      analysisWarnings: Array.isArray(analysis.analysis_warnings) ? analysis.analysis_warnings : [],
    };
  }, [route]);

  // Apply category filtering and optional search query
  const filteredIntersections = useMemo(() => {
    return intersectionsList.filter((item) => {
      // Category filter
      if (filterMode === "signalized" && !item.is_signalized) return false;
      if (filterMode === "unsignalized" && item.is_signalized) return false;

      // Text search filter (node ID, sequence number)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesNodeId = String(item.osm_node_id).toLowerCase().includes(q);
        const matchesSeq = String(item.seq) === q || `#${item.seq}` === q;
        return matchesNodeId || matchesSeq;
      }
      return true;
    });
  }, [intersectionsList, filterMode, searchQuery]);

  // Empty State: No route selected
  if (!route) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center shadow-xl backdrop-blur-sm">
        <GitFork size={32} className="mx-auto text-slate-600 mb-3" />
        <h4 className="text-sm font-semibold text-slate-300">No Route Selected</h4>
        <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
          Generate routes between origin and destination to inspect intersections and signal delays along the chosen corridor.
        </p>
      </div>
    );
  }

  // Degraded / Missing analysis state
  if (analysisStatus !== "success" && totalCount === 0) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 shadow-xl backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 text-amber-400 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-amber-300">
              Intersection Analysis Degraded
            </h4>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Detailed intersection topology could not be extracted for this candidate route (Status:{" "}
              <code className="text-amber-300 font-mono text-[11px]">{analysisStatus}</code>).
            </p>
            {analysisWarnings.length > 0 && (
              <ul className="mt-2 list-disc list-inside space-y-1 text-[11px] text-slate-400">
                {analysisWarnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-sm">
      {/* Header and Summary Telemetry */}
      <div className="border-b border-slate-800 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow ${
                route.is_recommended ? "bg-emerald-500" : "bg-cyan-500"
              }`}
            >
              {route.rank || "#"}
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {route.summary || `Route ${route.rank || route.route_id}`} Intersections
              </h3>
              <p className="text-[11px] text-slate-400">
                {route.distance_km} km total &bull; Encounter sequence in travel order
              </p>
            </div>
          </div>

          {route.is_recommended && (
            <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              <CheckCircle2 size={12} />
              Recommended
            </span>
          )}
        </div>

        {/* Aggregate Counters */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <p className="text-base font-bold font-mono text-white">{totalCount}</p>
            <p className="text-[10px] text-slate-400">Total Nodes</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5">
            <p className="text-base font-bold font-mono text-amber-400">{signalCount}</p>
            <p className="text-[10px] text-amber-300/80">Mapped Signals</p>
          </div>
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-2.5">
            <p className="text-base font-bold font-mono text-indigo-400">{unsignalCount}</p>
            <p className="text-[10px] text-indigo-300/80">No Signal Tag</p>
          </div>
        </div>

        {densityPerKm != null && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-1.5 text-[11px] text-slate-400">
            <span>Intersection Density:</span>
            <strong className="font-mono text-slate-200">
              {densityPerKm.toFixed(2)} junctions / km
            </strong>
          </div>
        )}
      </div>

      {/* Filter and Search Controls */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-1">
          <button
            type="button"
            aria-pressed={filterMode === "all"}
            onClick={() => setFilterMode("all")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none ${
              filterMode === "all"
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>All</span>
            <span className="rounded-full bg-slate-700/60 px-1.5 py-0.2 text-[10px] text-slate-300 font-mono">
              {totalCount}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={filterMode === "signalized"}
            onClick={() => setFilterMode("signalized")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${
              filterMode === "signalized"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "text-slate-400 hover:text-amber-400"
            }`}
          >
            <span className="text-[10px]">🚦</span>
            <span>Signals</span>
            <span className="rounded-full bg-amber-950/60 px-1.5 py-0.2 text-[10px] text-amber-300 font-mono">
              {signalCount}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={filterMode === "unsignalized"}
            onClick={() => setFilterMode("unsignalized")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
              filterMode === "unsignalized"
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm"
                : "text-slate-400 hover:text-indigo-400"
            }`}
          >
            <GitFork size={12} />
            <span>No Signal Tag</span>
            <span className="rounded-full bg-indigo-950/60 px-1.5 py-0.2 text-[10px] text-indigo-300 font-mono">
              {unsignalCount}
            </span>
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Node ID or sequence #..."
            className="w-full rounded-xl border border-slate-800 bg-slate-950/60 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2 text-[11px] text-slate-500 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Intersections Scrollable Sequence List */}
      <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
        {filteredIntersections.length === 0 ? (
          <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-5 text-center text-xs text-slate-500">
            <Filter size={18} className="mx-auto mb-1.5 opacity-40" />
            No intersections match the selected filter.
          </div>
        ) : (
          filteredIntersections.map((inter, idx) => {
            const isSelected = String(inter.osm_node_id) === String(selectedIntersectionNodeId);
            const distKm = (inter.distance_along_route_m / 1000.0).toFixed(2);
            const distM = Math.round(inter.distance_along_route_m);
            const displayDist = inter.distance_along_route_m >= 1000 ? `${distKm} km` : `${distM} m`;

            const delayInfo = inter.signal_delay;
            const delaySeconds =
              delayInfo && typeof delayInfo.estimated_delay_s === "number"
                ? delayInfo.estimated_delay_s
                : null;

            return (
              <div
                key={`inter-${inter.osm_node_id}-${inter.seq || idx}`}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                onClick={() => onSelectIntersection?.(inter.osm_node_id, [inter.latitude, inter.longitude])}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectIntersection?.(inter.osm_node_id, [inter.latitude, inter.longitude]);
                  }
                }}
                className={`group cursor-pointer rounded-xl border p-3 transition-all focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none ${
                  isSelected
                    ? "border-cyan-500 bg-cyan-950/30 shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-500/50"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/60"
                }`}
              >
                {/* Header Row: Sequence, Type Badge, and Map Jump Indicator */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold font-mono ${
                        inter.is_signalized
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40"
                      }`}
                    >
                      {inter.seq}
                    </span>

                    {inter.is_signalized ? (
                      <span className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                        <span>🚦</span>
                        <span>Mapped Signal</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                        <GitFork size={10} className="text-indigo-400" />
                        <span>No Mapped Signal Tag</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[11px] font-semibold text-slate-300">
                      {displayDist}
                    </span>
                    <ChevronRight
                      size={14}
                      className={`text-slate-500 transition group-hover:translate-x-0.5 ${
                        isSelected ? "text-cyan-400" : ""
                      }`}
                    />
                  </div>
                </div>

                {/* Details Row: Node ID, Coordinates, Offset */}
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
                  <div className="flex items-center gap-1 truncate">
                    <span className="text-slate-500">Node:</span>
                    <span className="font-mono text-slate-200">#{inter.osm_node_id}</span>
                    <button
                      type="button"
                      onClick={(e) => handleCopyNodeId(e, inter.osm_node_id)}
                      className="text-slate-500 hover:text-slate-200 ml-0.5 focus-visible:ring-1 focus-visible:ring-cyan-400 focus-visible:outline-none rounded"
                      title="Copy OSM Node ID"
                      aria-label={`Copy OSM Node ID ${inter.osm_node_id}`}
                    >
                      {copiedNodeId === inter.osm_node_id ? (
                        <Check size={11} className="text-emerald-400" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  </div>

                  <div className="truncate text-right">
                    <span className="text-slate-500">Offset:</span>{" "}
                    <span className="font-mono text-slate-300">
                      {inter.distance_from_route_m.toFixed(1)} m
                    </span>
                  </div>
                </div>

                {/* Coordinates */}
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Coordinates:</span>
                  <span>{formatCoordinate(inter.latitude, inter.longitude)}</span>
                </div>

                {/* Signal Attributes or Unmodeled Delay Notice */}
                {inter.is_signalized ? (
                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[11px]">
                    <div className="flex items-center justify-between text-amber-300">
                      <span className="flex items-center gap-1 font-semibold">
                        <Clock size={11} />
                        Modeled Delay:
                      </span>
                      <strong className="font-mono">
                        {delaySeconds != null ? `~${delaySeconds.toFixed(1)}s` : "~20.0s (default)"}
                      </strong>
                    </div>

                    {delayInfo && (
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>Cycle: {delayInfo.cycle_length_s}s</span>
                        <span>Red: {delayInfo.effective_red_time_s}s</span>
                        <span className="text-amber-400/80">d = R²/(2C)</span>
                      </div>
                    )}

                    {inter.signal_tags && Object.keys(inter.signal_tags).length > 0 && (
                      <div className="mt-1 text-[10px] text-slate-400 font-mono truncate">
                        Tags: {Object.entries(inter.signal_tags).map(([k, v]) => `${k}=${v}`).join(", ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 rounded-lg bg-slate-950/40 px-2 py-1 text-[10px] text-slate-500 italic">
                    No mapped signal tag &bull; Individual delay not modeled
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Engineering Disclaimers and Caveats */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[11px] text-slate-400 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-slate-300">
          <Info size={13} className="text-cyan-400" />
          <span>Data Methodology &amp; Engineering Caveats:</span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-slate-400 leading-relaxed text-[10.5px]">
          <li>
            <strong>Topological Intersections:</strong> Represent OpenStreetMap graph nodes with physical degree &ge; 3. Complex multi-arm or divided intersections may contain multiple adjacent graph nodes.
          </li>
          <li>
            <strong>Signal Tag Completeness:</strong> Signal status reflects OpenStreetMap tags (<code className="text-amber-300">highway=traffic_signals</code>). The absence of an OSM signal tag does not establish the absence of a physical traffic signal on the ground.
          </li>
          <li>
            <strong>Signal Delay Formulation:</strong> Delays are calculated using uniform-random-arrival approximation (<code className="text-emerald-400">d = R² / 2C</code>); individual delay is not modeled for intersections without mapped signal data.
          </li>
        </ul>
      </div>
    </div>
  );
}
