import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  CarFront,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import SignalHead from "./SignalHead";
import CycleTimeline from "./CycleTimeline";

const DIRECTIONS = ["north", "south", "east", "west"];

/**
 * Proportional queue bar that scales cleanly without distorting layout.
 */
function QueueMeter({ queue = 0, maxScale = 80, color = "bg-emerald-500" }) {
  const safeQueue = Math.max(0, Number(queue) || 0);
  const percent = Math.min(100, Math.round((safeQueue / maxScale) * 100));

  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between items-center text-[11px] font-mono">
        <span className="text-slate-600">Queue:</span>
        <span className="font-bold text-slate-900">{safeQueue} veh</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-50 border border-slate-200">
        <div
          className={`h-full transition-all duration-300 rounded-full ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * ApproachCard
 * ------------
 * Visual representation of an intersection approach (North, South, East, West).
 */
function ApproachCard({
  label,
  laneCount = 1,
  queue = 0,
  arrivals = null,
  discharged = null,
  arrivalRate = null,
  greenDuration = 25,
  isGreen = false,
  badgeColor = "text-emerald-600",
}) {
  const signalState = isGreen ? "green" : "red";

  return (
    <div
      className={`rounded-xl border p-3 transition-all duration-300 ${
        isGreen
          ? "border-emerald-500/80 bg-white shadow-[0_0_20px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/50"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold uppercase tracking-wider ${badgeColor}`}>
            {label}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
            {laneCount} {laneCount === 1 ? "Ln" : "Lns"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
              isGreen
                ? "bg-emerald-500/20 text-emerald-700 border border-emerald-500/40"
                : "bg-red-500/20 text-red-300 border border-red-500/40"
            }`}
          >
            {isGreen ? `${greenDuration}s Green` : "Stop"}
          </span>
          <SignalHead state={signalState} size="sm" label={label} />
        </div>
      </div>

      {/* Queue visual meter */}
      <QueueMeter queue={queue} color={isGreen ? "bg-emerald-400" : "bg-sky-500"} />

      {/* Numerical Data Badges */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10px] font-mono">
        <div className="rounded bg-white px-2 py-1 border border-slate-200/60">
          <span className="text-slate-500 block">Arrivals</span>
          <span className="text-slate-700 font-semibold">
            {arrivals !== null ? `+${arrivals} veh` : (arrivalRate !== null ? `${arrivalRate} v/m` : "--")}
          </span>
        </div>

        <div className="rounded bg-white px-2 py-1 border border-slate-200/60">
          <span className="text-slate-500 block">Discharged</span>
          <span className={discharged !== null ? "text-emerald-600 font-semibold" : "text-slate-600 font-semibold"}>
            {discharged !== null ? `-${discharged} veh` : "--"}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Main IntersectionVisualizer Component
 */
export default function IntersectionVisualizer({
  history = [],
  currentQueues = { north: 45, south: 30, east: 15, west: 10 },
  arrivalRates = { north: 12, south: 8, east: 4, west: 3 },
  lanes = { north: 1, south: 1, east: 1, west: 1 },
  strategy = "adaptive",
  cycleDuration = 120,
}) {
  const hasHistory = Array.isArray(history) && history.length > 0;
  const totalCycles = hasHistory ? history.length : 0;

  // Selected cycle: 0-indexed (0 to totalCycles - 1)
  const [selectedCycleIndex, setSelectedCycleIndex] = useState(0);

  // Active stage within the selected cycle: "north" | "south" | "east" | "west"
  const [activePhase, setActivePhase] = useState("north");

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1200); // ms per step

  const timerRef = useRef(null);

  // Clamped cycle index safe for current history
  const activeCycleIndex = hasHistory ? Math.min(selectedCycleIndex, totalCycles - 1) : 0;

  // Selected cycle data
  const currentCycleData = useMemo(() => {
    if (hasHistory && history[activeCycleIndex]) {
      return history[activeCycleIndex];
    }
    return null;
  }, [hasHistory, history, activeCycleIndex]);

  // Determine active green allocations
  const activeGreenTimes = useMemo(() => {
    if (currentCycleData && currentCycleData.green_times) {
      return currentCycleData.green_times;
    }
    return { north: 25, south: 25, east: 25, west: 25 };
  }, [currentCycleData]);

  // Determine approach display values (queues, arrivals, discharges)
  const approachData = useMemo(() => {
    const data = {};

    DIRECTIONS.forEach((d) => {
      if (currentCycleData) {
        // Post-simulation data from history
        const rem = currentCycleData.queues_after?.[d] ?? 0;
        const arr = currentCycleData.arrivals?.[d] ?? 0;
        const disc = currentCycleData.discharged?.[d] ?? 0;
        const gTime = currentCycleData.green_times?.[d] ?? 25;

        data[d] = {
          queue: rem,
          arrivals: arr,
          discharged: disc,
          arrivalRate: arrivalRates[d] ?? null,
          greenDuration: gTime,
          laneCount: lanes[d] ?? 1,
        };
      } else {
        // Pre-simulation baseline configuration
        data[d] = {
          queue: currentQueues[d] ?? 0,
          arrivals: null,
          discharged: null,
          arrivalRate: arrivalRates[d] ?? null,
          greenDuration: 25,
          laneCount: lanes[d] ?? 1,
        };
      }
    });

    return data;
  }, [currentCycleData, currentQueues, arrivalRates, lanes]);

  // Auto-advance step function for Play mode
  const advanceStep = useCallback(() => {
    const phaseOrder = ["north", "south", "east", "west"];
    const currentPhaseIdx = phaseOrder.indexOf(activePhase);

    if (currentPhaseIdx < phaseOrder.length - 1) {
      // Advance to next sequential approach phase in same cycle
      setActivePhase(phaseOrder[currentPhaseIdx + 1]);
    } else {
      // Completed all 4 phases of current cycle -> advance cycle
      setSelectedCycleIndex((prev) => {
        const next = prev + 1;
        if (next < totalCycles) {
          setActivePhase("north");
          return next;
        } else {
          setIsPlaying(false);
          return prev;
        }
      });
    }
  }, [activePhase, totalCycles]);

  // Playback timer effect
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(advanceStep, playbackSpeed);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isPlaying, advanceStep, playbackSpeed]);

  // Playback control actions
  const handleTogglePlay = () => {
    if (!hasHistory) return;
    if (activeCycleIndex >= totalCycles - 1 && activePhase === "west") {
      // Loop from beginning if already at end
      setSelectedCycleIndex(0);
      setActivePhase("north");
    }
    setIsPlaying((prev) => !prev);
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    if (!hasHistory) return;
    if (activeCycleIndex < totalCycles - 1) {
      setSelectedCycleIndex((prev) => Math.min(totalCycles - 1, prev + 1));
    }
  };

  const handleStepBackward = () => {
    setIsPlaying(false);
    if (!hasHistory) return;
    if (activeCycleIndex > 0) {
      setSelectedCycleIndex((prev) => Math.max(0, prev - 1));
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    setSelectedCycleIndex(0);
    setActivePhase("north");
  };

  const handleCycleSlider = (e) => {
    setIsPlaying(false);
    setSelectedCycleIndex(Number(e.target.value));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
      {/* Visualizer Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <CarFront className="text-emerald-600" size={18} />
              Four-Approach Intersection Visualizer
            </h2>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-600 border border-emerald-500/30">
              {strategy === "adaptive" ? "Adaptive Signal Control" : "Fixed-Time (25s Split)"}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Sequential split-phase service (North → South → East → West). No concurrent opposing green movements.
          </p>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasHistory}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Reset to Cycle 1"
          >
            <RotateCcw size={15} />
          </button>

          <button
            type="button"
            onClick={handleStepBackward}
            disabled={!hasHistory || activeCycleIndex === 0}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Step Back One Cycle"
          >
            <SkipBack size={15} />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            disabled={!hasHistory}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition ${
              isPlaying
                ? "bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                : "bg-emerald-600 text-white hover:bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isPlaying ? "Pause Playback" : "Play Cycle Progression"}
          >
            {isPlaying ? (
              <>
                <Pause size={14} /> Pause
              </>
            ) : (
              <>
                <Play size={14} /> Play
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleStepForward}
            disabled={!hasHistory || activeCycleIndex >= totalCycles - 1}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Step Forward One Cycle"
          >
            <SkipForward size={15} />
          </button>

          <div className="h-4 w-px bg-slate-100 mx-1" />

          {/* Cycle scrub slider */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-mono text-slate-700 font-semibold whitespace-nowrap">
              {hasHistory ? `Cycle ${activeCycleIndex + 1}/${totalCycles}` : "Pre-Sim"}
            </span>
            {hasHistory && (
              <input
                type="range"
                min="0"
                max={totalCycles - 1}
                value={activeCycleIndex}
                onChange={handleCycleSlider}
                className="w-20 sm:w-28 accent-emerald-500 h-1.5 bg-slate-100 rounded-lg cursor-pointer"
                title="Scrub Cycle History"
              />
            )}
          </div>

          {/* Speed Selector */}
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="rounded bg-white border border-slate-200 text-[10px] text-slate-700 px-1.5 py-1 outline-none"
            title="Playback Speed"
          >
            <option value={1800}>0.75x</option>
            <option value={1200}>1.0x</option>
            <option value={600}>2.0x</option>
          </select>
        </div>
      </div>

      {/* Main Intersection Schematic Viewport */}
      <div className="relative mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6 overflow-hidden">
        {/* Subtle grid background for engineering aesthetic */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f015_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f015_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        {/* 3x3 Schematic Grid */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          {/* Top Left: Empty / Status indicator */}
          <div className="hidden md:flex flex-col justify-end p-2 text-xs font-mono text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Right of Way Active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span>Stop / Holding Queue</span>
            </div>
          </div>

          {/* Top Center: NORTH APPROACH */}
          <div className="flex flex-col items-center">
            <div className="w-full max-w-xs">
              <ApproachCard
                direction="north"
                label="Northbound"
                laneCount={approachData.north.laneCount}
                queue={approachData.north.queue}
                arrivals={approachData.north.arrivals}
                discharged={approachData.north.discharged}
                arrivalRate={approachData.north.arrivalRate}
                greenDuration={approachData.north.greenDuration}
                isGreen={hasHistory && activePhase === "north"}
                badgeColor="text-emerald-600"
              />
            </div>
            <div className="h-6 w-px bg-slate-700/60 my-1 hidden md:block" />
          </div>

          {/* Top Right: Phase Status pill */}
          <div className="hidden md:flex justify-end items-start p-2">
            <div className="rounded-lg bg-white border border-slate-200 p-2.5 text-right font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase block">Current Phase</span>
              <span className="font-bold text-slate-900 uppercase text-sm">
                {hasHistory ? `${activePhase} Approach` : "Ready to Simulate"}
              </span>
              <span className="text-[10px] text-emerald-600 block mt-0.5">
                {hasHistory ? `${activeGreenTimes[activePhase]}s Allocation` : "All Signals Red"}
              </span>
            </div>
          </div>

          {/* Middle Left: WEST APPROACH */}
          <div className="flex items-center justify-end">
            <div className="w-full max-w-xs">
              <ApproachCard
                direction="west"
                label="Westbound"
                laneCount={approachData.west.laneCount}
                queue={approachData.west.queue}
                arrivals={approachData.west.arrivals}
                discharged={approachData.west.discharged}
                arrivalRate={approachData.west.arrivalRate}
                greenDuration={approachData.west.greenDuration}
                isGreen={hasHistory && activePhase === "west"}
                badgeColor="text-amber-600"
              />
            </div>
          </div>

          {/* Center Hub: Physical Intersection Road Box */}
          <div className="relative aspect-square w-full max-w-[260px] mx-auto rounded-xl bg-white border-2 border-slate-300 p-2 shadow-2xl flex flex-col items-center justify-center">
            {/* Crosswalk markings */}
            <div className="absolute top-1 inset-x-4 h-2 border-b-2 border-dashed border-slate-500/40" />
            <div className="absolute bottom-1 inset-x-4 h-2 border-t-2 border-dashed border-slate-500/40" />
            <div className="absolute left-1 inset-y-4 w-2 border-r-2 border-dashed border-slate-500/40" />
            <div className="absolute right-1 inset-y-4 w-2 border-l-2 border-dashed border-slate-500/40" />

            {/* Stop Bars (Glowing Red or Green depending on phase) */}
            {/* North Stop Bar */}
            <div
              className={`absolute top-3 inset-x-6 h-1 rounded transition-all duration-300 ${
                activePhase === "north" && hasHistory
                  ? "bg-emerald-400 shadow-[0_0_12px_#34d399]"
                  : "bg-red-500 shadow-[0_0_6px_#ef4444]"
              }`}
            />
            {/* South Stop Bar */}
            <div
              className={`absolute bottom-3 inset-x-6 h-1 rounded transition-all duration-300 ${
                activePhase === "south" && hasHistory
                  ? "bg-emerald-400 shadow-[0_0_12px_#34d399]"
                  : "bg-red-500 shadow-[0_0_6px_#ef4444]"
              }`}
            />
            {/* West Stop Bar */}
            <div
              className={`absolute left-3 inset-y-6 w-1 rounded transition-all duration-300 ${
                activePhase === "west" && hasHistory
                  ? "bg-emerald-400 shadow-[0_0_12px_#34d399]"
                  : "bg-red-500 shadow-[0_0_6px_#ef4444]"
              }`}
            />
            {/* East Stop Bar */}
            <div
              className={`absolute right-3 inset-y-6 w-1 rounded transition-all duration-300 ${
                activePhase === "east" && hasHistory
                  ? "bg-emerald-400 shadow-[0_0_12px_#34d399]"
                  : "bg-red-500 shadow-[0_0_6px_#ef4444]"
              }`}
            />

            {/* Center Intersection Flow Animation Arrow */}
            {hasHistory ? (
              <div className="flex flex-col items-center justify-center text-center p-2 z-10">
                <div className="animate-bounce mb-1">
                  {activePhase === "north" && <ArrowDown className="text-emerald-600" size={26} />}
                  {activePhase === "south" && <ArrowUp className="text-sky-600" size={26} />}
                  {activePhase === "east" && <ArrowLeft className="text-purple-400" size={26} />}
                  {activePhase === "west" && <ArrowRight className="text-amber-600" size={26} />}
                </div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-900">
                  {activePhase} Green
                </span>
                <span className="text-[9px] font-mono text-emerald-600">
                  {activeGreenTimes[activePhase]}s Active
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-2 z-10">
                <span className="font-mono text-[10px] text-slate-600 uppercase font-semibold">
                  Pre-Simulation
                </span>
                <span className="text-[9px] text-slate-500">
                  All Signals Red
                </span>
              </div>
            )}
          </div>

          {/* Middle Right: EAST APPROACH */}
          <div className="flex items-center justify-start">
            <div className="w-full max-w-xs">
              <ApproachCard
                direction="east"
                label="Eastbound"
                laneCount={approachData.east.laneCount}
                queue={approachData.east.queue}
                arrivals={approachData.east.arrivals}
                discharged={approachData.east.discharged}
                arrivalRate={approachData.east.arrivalRate}
                greenDuration={approachData.east.greenDuration}
                isGreen={hasHistory && activePhase === "east"}
                badgeColor="text-purple-400"
              />
            </div>
          </div>

          {/* Bottom Left: Empty */}
          <div className="hidden md:block" />

          {/* Bottom Center: SOUTH APPROACH */}
          <div className="flex flex-col items-center">
            <div className="h-6 w-px bg-slate-700/60 my-1 hidden md:block" />
            <div className="w-full max-w-xs">
              <ApproachCard
                direction="south"
                label="Southbound"
                laneCount={approachData.south.laneCount}
                queue={approachData.south.queue}
                arrivals={approachData.south.arrivals}
                discharged={approachData.south.discharged}
                arrivalRate={approachData.south.arrivalRate}
                greenDuration={approachData.south.greenDuration}
                isGreen={hasHistory && activePhase === "south"}
                badgeColor="text-sky-600"
              />
            </div>
          </div>

          {/* Bottom Right: Strategy pill */}
          <div className="hidden md:flex justify-end items-end p-2">
            <div className="rounded-lg bg-white border border-slate-200 p-2.5 text-right font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase block">Model Scope</span>
              <span className="text-slate-700 text-[11px] font-semibold">
                Macroscopic Fluid Queue
              </span>
              <span className="text-[10px] text-slate-500 block">
                C = 120s | G = 100s
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Cycle Timeline Bar */}
      <CycleTimeline
        greenTimes={activeGreenTimes}
        activePhase={hasHistory ? activePhase : null}
        onSelectPhase={(phase) => setActivePhase(phase)}
        cycleNumber={hasHistory ? activeCycleIndex + 1 : 1}
        cycleDuration={cycleDuration}
      />

      {/* Selected Cycle Detailed Verification & Invariant Badge */}
      {currentCycleData && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle className="text-emerald-600" size={16} />
            <span className="font-semibold text-slate-900">
              Cycle {activeCycleIndex + 1} Balance & Discharge Summary:
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-700">
            {DIRECTIONS.map((d) => (
              <span key={d} className="rounded bg-white px-2 py-1 border border-slate-200">
                <strong className="capitalize text-slate-600">{d[0].toUpperCase()}:</strong>{" "}
                <span className="text-slate-800">{currentCycleData.queues_before?.[d] ?? 0} init</span>{" "}
                <span className="text-slate-600">+ {currentCycleData.arrivals?.[d] ?? 0} arr</span>{" "}
                <span className="text-emerald-600">- {currentCycleData.discharged?.[d] ?? 0} disc</span>{" "}
                = <strong className="text-slate-900">{currentCycleData.queues_after?.[d] ?? 0} rem</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {!hasHistory && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-2 text-xs text-slate-600">
          <AlertCircle size={15} className="text-amber-600 shrink-0" />
          <span>
            Visualizer displaying configured approach geometry and initial queues. Click <strong>Run Simulation</strong> to compute stochastic cycle history and activate playback.
          </span>
        </div>
      )}
    </div>
  );
}
