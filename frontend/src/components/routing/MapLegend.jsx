import { useState } from "react";
import {
  Layers,
  ChevronDown,
  ChevronUp,
  MapPin,
  Compass,
} from "lucide-react";
import { ROUTE_STYLES } from "./mapConstants";

/**
 * Floating Map Legend
 * ===================
 * Displays color codes, boundary status, and marker explanations
 * for the Chandigarh Tricity Smart Route Planner canvas.
 */
export default function MapLegend({
  className = "",
  totalLandmarks = 7,
  hasActiveRoute = false,
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div
      className={`absolute bottom-6 left-6 z-[1000] overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-2xl backdrop-blur-md transition-all pointer-events-auto ${className} ${
        isExpanded ? "w-64" : "w-auto"
      }`}
    >
      {/* Legend Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-slate-800/60"
        title={isExpanded ? "Collapse map legend" : "Expand map legend"}
      >
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-300 uppercase">
          <Layers size={14} className="text-emerald-400" />
          {isExpanded && <span>Map Legend</span>}
        </div>
        <div className="text-slate-400">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      {/* Legend Body */}
      {isExpanded && (
        <div className="space-y-3 border-t border-slate-800 p-3 pt-2 text-xs">
          {/* Geographical Coverage */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>Geographic Boundary</span>
              <span className="font-mono text-[10px] text-emerald-400">Tricity</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-950/60 p-1.5">
              <span
                className="inline-block h-2.5 w-6 rounded border border-blue-400/80"
                style={{
                  backgroundColor: ROUTE_STYLES.boundary.fillColor,
                  borderStyle: "dashed",
                }}
              />
              <span className="text-[11px] text-slate-300">
                Chandigarh Tricity (35×35 km)
              </span>
            </div>
          </div>

          {/* Route Polylines */}
          <div>
            <p className="mb-1 text-[11px] text-slate-400">Routing Representation</p>
            <div className="space-y-1.5 rounded-lg bg-slate-950/60 p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-1.5 w-5 rounded-full"
                    style={{ backgroundColor: ROUTE_STYLES.recommended.color }}
                  />
                  <span className="text-[11px] text-slate-300">Recommended Route</span>
                </div>
                <span className="rounded bg-emerald-500/10 px-1 py-0.2 text-[9px] font-semibold text-emerald-400">
                  Rank 1
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-1.5 w-5 rounded-full border border-dashed"
                    style={{
                      borderColor: ROUTE_STYLES.alternative.color,
                      backgroundColor: "transparent",
                    }}
                  />
                  <span className="text-[11px] text-slate-400">Alternative Options</span>
                </div>
                <span className="text-[9px] text-slate-500">OSRM</span>
              </div>
            </div>
          </div>

          {/* Markers / Nodes */}
          <div>
            <p className="mb-1 text-[11px] text-slate-400">Waypoints & Route Intersections</p>
            <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950/60 p-2 text-[10px]">
              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <MapPin size={10} />
                </span>
                <span>Origin / Dest</span>
              </div>

              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 font-bold text-[9px]">
                  🚦
                </span>
                <span>Mapped Signals</span>
              </div>

              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-500/20 text-purple-400">
                  <Compass size={10} />
                </span>
                <span>{totalLandmarks} Urban Hubs</span>
              </div>

              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 font-mono text-[9px] font-bold">
                  #
                </span>
                <span>No Mapped Signal Tag</span>
              </div>
            </div>
          </div>

          {hasActiveRoute && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] text-emerald-300 leading-relaxed">
              Intersections along selected route are rendered as interactive markers. "Mapped Signal" indicates OSM signal tag presence; other topological intersections lack this tag in OSM (individual delay not modeled).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
