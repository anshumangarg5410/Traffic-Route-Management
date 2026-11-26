import { useState } from "react";
import {
  Activity,
  Clock,
  TrafficCone,
  Zap,
  RotateCcw,
  Layers,
  Info,
  CheckCircle,
} from "lucide-react";

import { optimizeSignal } from "../services/api";
import { useTraffic } from "../context/TrafficContext";

const directions = [
  { key: "north", label: "North", color: "bg-emerald-500", text: "text-emerald-600" },
  { key: "south", label: "South", color: "bg-blue-500", text: "text-blue-400" },
  { key: "east", label: "East", color: "bg-purple-500", text: "text-purple-400" },
  { key: "west", label: "West", color: "bg-orange-500", text: "text-orange-400" },
];

export default function SignalOptimization() {
  const {
    initialQueues: counts,
    lanes,
    saturationFlowRates: satRates,
    startupLostTimes: lostTimes,
    updateDirectionalQueues,
    updateLanes,
    updateSaturationFlowRates,
    updateStartupLostTimes,
    resetTrafficConfig,
  } = useTraffic();

  const [showCapacitySettings, setShowCapacitySettings] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (direction, value) => {
    updateDirectionalQueues(direction, value);
  };

  const handleLaneChange = (direction, value) => {
    updateLanes(direction, value);
  };

  const handleSatChange = (direction, value) => {
    updateSaturationFlowRates(direction, value);
  };

  const handleLostTimeChange = (direction, value) => {
    updateStartupLostTimes(direction, value);
  };

  const handleOptimize = async (event) => {
    event.preventDefault();

    const hasInvalidValue = Object.values(counts).some(
      (value) =>
        value === "" ||
        !Number.isInteger(Number(value)) ||
        Number(value) < 0
    );

    if (hasInvalidValue) {
      setError("Enter valid non-negative vehicle counts.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload = Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [
          key,
          Number(value),
        ])
      );

      const data = await optimizeSignal(payload);
      setResult(data);
    } catch (err) {
      setError(err.message || "Failed to optimize traffic signals.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    resetTrafficConfig();
    setResult(null);
    setError("");
  };

  const totalVehicles = Object.values(counts).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Signal Optimization</h1>
        <p className="mt-2 text-sm text-slate-600">
          Dynamically allocate green signal time based on approach traffic density and evaluate theoretical discharge capacity under lane constraints.
        </p>
      </div>

      {/* Cycle information */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {[
          {
            title: "Total Cycle",
            value: "120 sec",
            subtitle: "Cycle length",
            icon: Clock,
          },
          {
            title: "Available Green",
            value: "100 sec",
            subtitle: "4 directions (min 10s, max 40s)",
            icon: Activity,
          },
          {
            title: "Total Queued Vehicles",
            value: `${totalVehicles} veh`,
            subtitle: "Demand awaiting service",
            icon: TrafficCone,
          },
        ].map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.title}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">{item.title}</p>
                <Icon size={20} className="text-emerald-600" />
              </div>

              <h2 className="mt-4 text-2xl font-bold text-slate-900">{item.value}</h2>
              <p className="mt-1 text-xs text-slate-500">{item.subtitle}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Traffic input form */}
        <form
          onSubmit={handleOptimize}
          className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="rounded-lg bg-emerald-500/10 p-2">
                <TrafficCone className="text-emerald-600" size={20} />
              </div>

              <div>
                <h2 className="font-semibold text-slate-900">Traffic Density Input</h2>
                <p className="text-xs text-slate-600">
                  Enter current vehicles waiting in each direction.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {directions.map((direction) => (
                <div key={direction.key}>
                  <label className="mb-2 block text-xs capitalize text-slate-600">
                    {direction.label} Vehicles
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={counts[direction.key]}
                    onChange={(event) =>
                      handleChange(direction.key, event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>

            <div className="my-6 border-t border-slate-200" />

            {/* Capacity & Geometry Parameters */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Layers size={16} className="text-emerald-600" />
                Capacity & Geometry Parameters
              </div>
              <button
                type="button"
                onClick={() => setShowCapacitySettings(!showCapacitySettings)}
                className="text-xs text-emerald-600 hover:text-emerald-700 underline"
              >
                {showCapacitySettings ? "Hide Capacity Controls" : "Edit Capacity Controls"}
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs text-slate-600">Lanes per Direction</label>
                <div className="grid grid-cols-4 gap-3">
                  {directions.map((d) => (
                    <div key={d.key}>
                      <span className="mb-1 block text-xs capitalize text-slate-500">{d.label}</span>
                      <input
                        type="number"
                        min="1"
                        max="6"
                        step="1"
                        value={lanes[d.key]}
                        onChange={(e) => handleLaneChange(d.key, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {showCapacitySettings && (
                <>
                  <div>
                    <label className="mb-2 block text-xs text-slate-600">
                      Saturation Flow Rate (veh / hr / lane)
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      {directions.map((d) => (
                        <div key={d.key}>
                          <span className="mb-1 block text-xs capitalize text-slate-500">{d.label}</span>
                          <input
                            type="number"
                            min="500"
                            max="3000"
                            step="50"
                            value={satRates[d.key]}
                            onChange={(e) => handleSatChange(d.key, e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs text-slate-600">
                      Startup Lost Time (seconds per phase)
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      {directions.map((d) => (
                        <div key={d.key}>
                          <span className="mb-1 block text-xs capitalize text-slate-500">{d.label}</span>
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.5"
                            value={lostTimes[d.key]}
                            onChange={(e) => handleLostTimeChange(d.key, e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            {error && <p className="mt-4 text-xs text-red-600">{error}</p>}

            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Zap size={17} />
                {loading ? "Optimizing Timings..." : "Optimize Signal Allocation"}
              </button>

              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-slate-300 px-4 text-slate-700 hover:bg-slate-100"
                title="Reset values"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </div>
        </form>

        {/* Optimization & Capacity Results */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Adaptive Signal & Capacity Allocation</h2>
            <p className="mt-1 text-xs text-slate-600">
              Optimal green-light durations, effective green times, and theoretical single-cycle discharge capacity.
            </p>

            {!result ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center">
                <Activity size={40} className="text-slate-700" />
                <p className="mt-4 text-sm text-slate-600">
                  Enter traffic counts and optimize signals to view timing & capacity allocations.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {/* Visual green time bars */}
                <div className="space-y-4">
                  {directions.map((direction) => {
                    const nominalGreen = result.green_times[direction.key];
                    const lost = Number(lostTimes[direction.key]) || 0;
                    const effGreen = Math.max(0, nominalGreen - lost);
                    const lCount = Number(lanes[direction.key]) || 1;
                    const sat = Number(satRates[direction.key]) || 1800;
                    const theoCap = Math.round((sat * lCount * (effGreen / 3600)) * 100) / 100;
                    const intCap = Math.floor(theoCap);
                    const queueVal = Number(counts[direction.key]) || 0;
                    const coverage = queueVal > 0 ? Math.min(100, Math.round((intCap / queueVal) * 100)) : 100;

                    return (
                      <div key={direction.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold capitalize text-slate-900 flex items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${direction.color}`} />
                            {direction.label}
                          </span>
                          <span className="font-semibold text-emerald-600">
                            {nominalGreen}s nominal ({effGreen.toFixed(1)}s eff)
                          </span>
                        </div>

                        {/* Green time bar */}
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${direction.color} transition-all duration-500`}
                            style={{ width: `${(nominalGreen / result.total_green_time) * 100}%` }}
                          />
                        </div>

                        {/* Capacity metrics row */}
                        <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] text-slate-600">
                          <div>
                            <span>Queue: </span>
                            <span className="font-semibold text-slate-900">{queueVal}</span>
                          </div>
                          <div>
                            <span>Capacity: </span>
                            <span className="font-semibold text-sky-600">{intCap} veh</span>
                          </div>
                          <div>
                            <span>Cleared: </span>
                            <span className={`font-semibold ${coverage >= 100 ? "text-emerald-600" : "text-amber-600"}`}>
                              {coverage}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="rounded-lg bg-slate-100 p-3">
                    <p className="text-xs text-slate-600">Total Allocated Green</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {result.total_green_time}s
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-100 p-3">
                    <p className="text-xs text-slate-600">Clearance Interval</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {result.clearance_time}s
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {result && (
            <div className="mt-5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs text-slate-600 flex items-start gap-2">
              <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-emerald-600">Optimization & Constraint Guarantee: </span>
                Total green time strictly conserves 100s. Every direction receives between 10s and 40s. Single-cycle discharge capacity is calculated using effective green time <code className="text-emerald-600">g = max(0, G - l_s)</code> and floored to whole vehicles.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assumptions Footer */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
          <Info size={15} className="text-emerald-600" />
          Timing Constraints & Capacity Formulation
        </div>
        <p>
          Cycle duration is fixed at 120 seconds with 20 seconds total clearance interval (all-red + yellow transitions across stages). Nominal green times are allocated proportionally to relative queue demands via water-filling with capping. Effective green accounts for startup lost time (default 2.0s), and discharge capacity follows <code className="text-emerald-600">C_d = s_d × L_d × (g_d / 3600)</code>.
        </p>
      </div>
    </div>
  );
}
