import { Clock } from "lucide-react";

/**
 * CycleTimeline Component
 * -----------------------
 * Visualizes the 120-second signal timing cycle with:
 * - 4 non-overlapping sequential green phases (North -> South -> East -> West)
 * - 4 inter-stage yellow/clearance transitions (5s each = 20s total clearance)
 * - Proportional visual widths corresponding to exact green allocations
 * - Interactive phase selection
 */
export default function CycleTimeline({
  greenTimes = { north: 25, south: 25, east: 25, west: 25 },
  activePhase = "north",
  onSelectPhase,
  cycleNumber = 1,
  cycleDuration = 120,
  clearancePerPhase = 5,
}) {
  const directions = ["north", "south", "east", "west"];

  const phaseColors = {
    north: {
      bg: "bg-emerald-500",
      activeBg: "bg-emerald-400",
      border: "border-emerald-400",
      text: "text-emerald-600",
      pill: "bg-emerald-500/20 text-emerald-700 border-emerald-500/40",
    },
    south: {
      bg: "bg-sky-500",
      activeBg: "bg-sky-400",
      border: "border-sky-400",
      text: "text-sky-600",
      pill: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    },
    east: {
      bg: "bg-purple-500",
      activeBg: "bg-purple-400",
      border: "border-purple-400",
      text: "text-purple-400",
      pill: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    },
    west: {
      bg: "bg-amber-500",
      activeBg: "bg-amber-400",
      border: "border-amber-400",
      text: "text-amber-600",
      pill: "bg-amber-500/20 text-amber-700 border-amber-500/40",
    },
  };

  // Build sequential timeline segments
  let cumulativeTime = 0;
  const segments = [];

  directions.forEach((dir, idx) => {
    const greenDuration = Number(greenTimes[dir]) || 25;
    const startGreen = cumulativeTime;
    const endGreen = startGreen + greenDuration;
    cumulativeTime = endGreen;

    // Green segment
    segments.push({
      type: "green",
      direction: dir,
      duration: greenDuration,
      start: startGreen,
      end: endGreen,
      percentWidth: (greenDuration / cycleDuration) * 100,
    });

    // Clearance segment (5s)
    const startClear = cumulativeTime;
    const endClear = startClear + clearancePerPhase;
    cumulativeTime = endClear;

    segments.push({
      type: "clearance",
      direction: dir,
      duration: clearancePerPhase,
      start: startClear,
      end: Math.min(cycleDuration, endClear),
      percentWidth: (clearancePerPhase / cycleDuration) * 100,
      phaseIndex: idx + 1,
    });
  });

  const totalGreen = directions.reduce(
    (sum, d) => sum + (Number(greenTimes[d]) || 0),
    0
  );
  const totalClearance = clearancePerPhase * 4;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-emerald-600" />
          <span className="font-semibold text-slate-900">
            Cycle {cycleNumber} Timing Timeline
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 border border-slate-300">
            {cycleDuration}s Total ({totalGreen}s Green + {totalClearance}s Clearance)
          </span>
        </div>

        {/* Phase Pill Buttons */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-600 mr-1">Active Phase:</span>
          {directions.map((d) => {
            const isActive = activePhase === d;
            const colors = phaseColors[d];
            return (
              <button
                key={d}
                type="button"
                onClick={() => onSelectPhase && onSelectPhase(d)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition border ${
                  isActive
                    ? `${colors.pill} ring-1 ring-white/40 shadow-sm`
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-100"
                }`}
                title={`Select ${d} phase (${greenTimes[d]}s)`}
              >
                {d} ({greenTimes[d]}s)
              </button>
            );
          })}
        </div>
      </div>

      {/* Visual Timeline Track */}
      <div className="space-y-1.5 pt-1">
        <div className="relative h-7 w-full overflow-hidden rounded-lg bg-slate-50 border border-slate-200 flex">
          {segments.map((seg, i) => {
            if (seg.type === "green") {
              const isActive = activePhase === seg.direction;
              const colors = phaseColors[seg.direction];
              return (
                <div
                  key={`green-${seg.direction}-${i}`}
                  onClick={() => onSelectPhase && onSelectPhase(seg.direction)}
                  style={{ width: `${seg.percentWidth}%` }}
                  className={`h-full relative flex items-center justify-center cursor-pointer transition-all ${
                    colors.bg
                  } ${
                    isActive
                      ? "ring-2 ring-inset ring-white font-bold opacity-100 shadow-[0_0_12px_rgba(255,255,255,0.4)]"
                      : "opacity-75 hover:opacity-90"
                  }`}
                  title={`${seg.direction.toUpperCase()} Green: ${seg.duration}s [${seg.start}s - ${seg.end}s]`}
                >
                  <span className="truncate px-1 text-[10px] font-bold text-slate-950 uppercase tracking-tight">
                    {seg.direction.toUpperCase()}: {seg.duration}s
                  </span>
                </div>
              );
            } else {
              return (
                <div
                  key={`clearance-${seg.direction}-${i}`}
                  style={{ width: `${seg.percentWidth}%` }}
                  className="h-full bg-amber-500/30 border-r border-slate-900 flex items-center justify-center relative cursor-default"
                  title={`Clearance Interval ${seg.phaseIndex}: ${seg.duration}s yellow/all-red transition`}
                >
                  <span className="text-[9px] text-amber-700 font-mono font-bold select-none">
                    5s
                  </span>
                </div>
              );
            }
          })}
        </div>

        {/* Time Scale Marks (0s, 30s, 60s, 90s, 120s) */}
        <div className="relative flex justify-between text-[10px] font-mono text-slate-600 px-0.5">
          <span>0s</span>
          <span>30s</span>
          <span>60s</span>
          <span>90s</span>
          <span>120s</span>
        </div>
      </div>

      {/* Description & Engineering Note */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
        <span>
          Sequence:{" "}
          <strong className="text-slate-700 font-mono">
            North (Stage 1) → South (Stage 2) → East (Stage 3) → West (Stage 4)
          </strong>
        </span>
        <span className="text-slate-600">
          Sequential non-conflicting service with 5s inter-stage clearance transitions
        </span>
      </div>
    </div>
  );
}
