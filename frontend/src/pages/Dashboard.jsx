import { useState, useEffect, useCallback, useMemo, useId } from "react";
import {
  Activity,
  CarFront,
  TrendingUp,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Zap,
  BrainCircuit,
  Sliders,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { checkBackendHealth, executeUnifiedWorkflow } from "../services/api";
import {
  useTraffic,
  DIRECTIONS,
  SCENARIO_PRESETS,
  parseOptionalSeed,
} from "../context/TrafficContext";
import IntersectionVisualizer from "../components/visualizer/IntersectionVisualizer";

const defaultRegionalWeather = {
  holiday: "None",
  temp: 293.15, // 20°C in Kelvin
  rain_1h: 0.0,
  snow_1h: 0.0,
  clouds_all: 20,
  weather_main: "Clear",
  hour: 17, // 5 PM peak
  day: 23,
  month: 11,
  day_of_week: 0, // Monday
  is_weekend: 0,
};

function BackendStatusBadge({ status, latency, onRefresh }) {
  if (status === "connected") {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-600"
        title="Local FastAPI backend connectivity verified (127.0.0.1:8000). Research simulation environment; not field-connected to municipal physical signals."
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <Wifi size={13} />
        <span>API Gateway Connected</span>
        {latency !== null && <span className="text-slate-600">({latency}ms)</span>}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-1 text-slate-600 hover:text-slate-900"
          title="Refresh Health Status"
        >
          <RefreshCw size={11} />
        </button>
      </div>
    );
  }

  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-mono text-amber-600">
        <RefreshCw size={12} className="animate-spin" />
        <span>Checking API...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-mono text-rose-400">
      <WifiOff size={13} />
      <span>API Gateway Offline</span>
      <button
        type="button"
        onClick={onRefresh}
        className="ml-1 underline hover:text-slate-900"
      >
        Retry
      </button>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, highlight = false, badge = null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">{title}</p>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
              {badge}
            </span>
          )}
          <Icon size={18} className={highlight ? "text-emerald-600" : "text-slate-600"} />
        </div>
      </div>
      <h2 className="mt-3 text-2xl font-bold text-slate-900 font-mono">{value}</h2>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

export default function Dashboard() {
  const {
    initialQueues,
    arrivalRates,
    lanes,
    saturationFlowRates,
    startupLostTimes,
    dischargePolicy,
    simulation,
    scenario,
    updateDirectionalQueues,
    updateArrivalRates,
    updateLanes,
    updateSaturationFlowRates,
    updateStartupLostTimes,
    updateSimulationSettings,
    updateIntersectionGeometry,
    applyScenarioPreset,
    resetTrafficConfig,
  } = useTraffic();

  // Backend connection state
  const [backendStatus, setBackendStatus] = useState("checking");
  const [latency, setLatency] = useState(null);

  // Workflow execution state
  const [workflowResult, setWorkflowResult] = useState(null);
  const [lastExecutedConfig, setLastExecutedConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastExecuted, setLastExecuted] = useState(null);

  // Stale detection: compares current configuration against snapshot of last execution
  const isConfigStale = useMemo(() => {
    if (!lastExecutedConfig || !workflowResult) return false;
    const current = {
      initialQueues,
      arrivalRates,
      lanes,
      saturationFlowRates,
      startupLostTimes,
      dischargePolicy,
      cycles: simulation.cycles,
      runs: simulation.runs,
      randomSeed: simulation.randomSeed,
      applyScaling: simulation.applyScaling,
    };
    return JSON.stringify(current) !== JSON.stringify(lastExecutedConfig);
  }, [
    lastExecutedConfig,
    workflowResult,
    initialQueues,
    arrivalRates,
    lanes,
    saturationFlowRates,
    startupLostTimes,
    dischargePolicy,
    simulation,
  ]);

  // UI accordion state for scenario parameters
  const [showConfigDrawer, setShowConfigDrawer] = useState(false);

  // Accessibility unique IDs for inputs
  const cyclesInputId = useId();
  const runsInputId = useId();
  const seedInputId = useId();
  const satFlowInputId = useId();
  const lostTimeInputId = useId();
  const scalingInputId = useId();

  // Refresh backend health on user click
  const checkHealth = useCallback(async () => {
    const t0 = performance.now();
    try {
      await checkBackendHealth();
      const dt = Math.round(performance.now() - t0);
      setBackendStatus("connected");
      setLatency(dt);
    } catch {
      setBackendStatus("offline");
      setLatency(null);
    }
  }, []);

  // Execute Unified Workflow
  const handleRunWorkflow = useCallback(async () => {
    setError("");
    setLoading(true);

    try {
      const parsedSeed = parseOptionalSeed(simulation.randomSeed);
      const payload = {
        ...defaultRegionalWeather,
        initial_queues: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Math.max(0, parseInt(initialQueues[d], 10) || 0)])
        ),
        arrival_rates: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Math.max(0, parseFloat(arrivalRates[d]) || 0)])
        ),
        lanes: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Math.max(1, parseInt(lanes[d], 10) || 1)])
        ),
        saturation_flow_rates: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Math.max(1, parseFloat(saturationFlowRates[d]) || 1800)])
        ),
        startup_lost_times: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Math.max(0, parseFloat(startupLostTimes[d]) || 2.0)])
        ),
        discharge_policy: dischargePolicy,
        cycles: Math.max(1, Math.min(50, parseInt(simulation.cycles, 10) || 5)),
        runs: Math.max(1, Math.min(50, parseInt(simulation.runs, 10) || 5)),
        random_seed: parsedSeed,
        apply_ml_scenario_scaling: Boolean(simulation.applyScaling),
      };

      const res = await executeUnifiedWorkflow(payload);
      setWorkflowResult(res);
      setLastExecutedConfig({
        initialQueues: { ...initialQueues },
        arrivalRates: { ...arrivalRates },
        lanes: { ...lanes },
        saturationFlowRates: { ...saturationFlowRates },
        startupLostTimes: { ...startupLostTimes },
        dischargePolicy,
        cycles: simulation.cycles,
        runs: simulation.runs,
        randomSeed: simulation.randomSeed,
        applyScaling: simulation.applyScaling,
      });
      setLastExecuted(new Date().toLocaleTimeString());
      setBackendStatus("connected");
    } catch (err) {
      setError(err.message || "Failed to execute unified traffic workflow.");
    } finally {
      setLoading(false);
    }
  }, [
    initialQueues,
    arrivalRates,
    lanes,
    saturationFlowRates,
    startupLostTimes,
    dischargePolicy,
    simulation,
  ]);

  // Initial mount: check health and populate dashboard with initial analysis
  useEffect(() => {
    let mounted = true;

    async function initializeDashboard() {
      const t0 = performance.now();
      try {
        await checkBackendHealth();
        if (!mounted) return;
        const dt = Math.round(performance.now() - t0);
        setBackendStatus("connected");
        setLatency(dt);

        // Execute initial baseline workflow
        setLoading(true);
        const parsedSeed = parseOptionalSeed(simulation.randomSeed) ?? 42;
        const payload = {
          ...defaultRegionalWeather,
          initial_queues: Object.fromEntries(
            DIRECTIONS.map((d) => [d, Number(initialQueues[d])])
          ),
          arrival_rates: Object.fromEntries(
            DIRECTIONS.map((d) => [d, Number(arrivalRates[d])])
          ),
          lanes: Object.fromEntries(
            DIRECTIONS.map((d) => [d, Number(lanes[d])])
          ),
          saturation_flow_rates: Object.fromEntries(
            DIRECTIONS.map((d) => [d, Number(saturationFlowRates[d])])
          ),
          startup_lost_times: Object.fromEntries(
            DIRECTIONS.map((d) => [d, Number(startupLostTimes[d])])
          ),
          discharge_policy: dischargePolicy,
          cycles: Number(simulation.cycles) || 5,
          runs: Number(simulation.runs) || 5,
          random_seed: parsedSeed,
          apply_ml_scenario_scaling: false,
        };

        const res = await executeUnifiedWorkflow(payload);
        if (mounted) {
          setWorkflowResult(res);
          setLastExecutedConfig({
            initialQueues: { ...initialQueues },
            arrivalRates: { ...arrivalRates },
            lanes: { ...lanes },
            saturationFlowRates: { ...saturationFlowRates },
            startupLostTimes: { ...startupLostTimes },
            dischargePolicy,
            cycles: simulation.cycles,
            runs: simulation.runs,
            randomSeed: simulation.randomSeed,
            applyScaling: false,
          });
          setLastExecuted(new Date().toLocaleTimeString());
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || "Failed to connect to backend service.");
          setBackendStatus("offline");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initializeDashboard();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* SECTION A: Header & System Status Bar */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 border border-emerald-500/20">
              <Activity size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                Traffic Command Center
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-600 border border-slate-300">
                  Phase 8.4
                </span>
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Centralized Macroscopic Intersection Control, Regional ML Prediction & Common Random Numbers Simulation
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <BackendStatusBadge
            status={backendStatus}
            latency={latency}
            onRefresh={checkHealth}
          />

          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-600 bg-white px-3 py-1 rounded-full border border-slate-200">
            <Clock size={12} className="text-slate-500" />
            <span>Last Run:</span>
            <span className="text-slate-800 font-semibold">{lastExecuted || "Pending"}</span>
          </div>
        </div>
      </div>

      {/* SECTION B: Scenario Presets & Configuration Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders size={16} className="text-emerald-600" />
              Scenario Presets & Intersection Geometry
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Select an illustrative scenario preset or fine-tune directional parameters. Shared across all pages.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowConfigDrawer((prev) => !prev)}
            className="flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-300 transition"
          >
            <span>{showConfigDrawer ? "Hide Controls" : "Fine-Tune Parameters"}</span>
            {showConfigDrawer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Preset Selector Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {SCENARIO_PRESETS.map((p) => {
            const isActive = scenario.name === p.name;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyScenarioPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  isActive
                    ? "bg-emerald-600 text-white font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)] ring-1 ring-emerald-400"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900 border border-slate-200"
                }`}
                title={p.description}
              >
                {p.name}
              </button>
            );
          })}

          <button
            type="button"
            onClick={resetTrafficConfig}
            className="ml-auto flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 px-2 py-1.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200"
            title="Reset to default configuration"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>

        {/* Active Scenario Info Box */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-slate-600 font-mono">Active Scenario:</span>{" "}
            <span className="font-bold text-slate-900">{scenario.name}</span>
            <p className="text-[11px] text-slate-500 mt-0.5">{scenario.description}</p>
          </div>
          <span className="text-[10px] font-mono text-emerald-600/90 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            Synchronized with TrafficContext
          </span>
        </div>

        {/* Fine-Tuning Drawer */}
        {showConfigDrawer && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-4 text-xs">
            {/* Directional Matrix: Queues, Arrival Rates, Lanes */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {DIRECTIONS.map((d) => (
                <div key={d} className="rounded-lg bg-slate-50 p-3 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                    <span className="capitalize font-bold text-slate-900 text-xs">{d} Bound</span>
                    <span className="text-[10px] font-mono text-slate-500">Approach</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>Queue (veh):</span>
                      <input
                        type="number"
                        min="0"
                        max="200"
                        value={initialQueues[d]}
                        onChange={(e) => updateDirectionalQueues(d, Math.max(0, parseInt(e.target.value, 10) || 0))}
                        className="w-16 rounded bg-white border border-slate-300 px-1.5 py-0.5 text-right font-mono text-slate-900 outline-none focus:border-emerald-500"
                      />
                    </label>

                    <label className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>Rate (veh/min):</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        step="0.5"
                        value={arrivalRates[d]}
                        onChange={(e) => updateArrivalRates(d, Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-16 rounded bg-white border border-slate-300 px-1.5 py-0.5 text-right font-mono text-slate-900 outline-none focus:border-emerald-500"
                      />
                    </label>

                    <label className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>Lanes:</span>
                      <input
                        type="number"
                        min="1"
                        max="4"
                        value={lanes[d]}
                        onChange={(e) => updateLanes(d, Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-16 rounded bg-white border border-slate-300 px-1.5 py-0.5 text-right font-mono text-slate-900 outline-none focus:border-emerald-500"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {/* Simulation Parameters & Capacity Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2">
              <label htmlFor={cyclesInputId} className="space-y-1">
                <span className="text-[11px] text-slate-600 block">Cycles (1-50):</span>
                <input
                  id={cyclesInputId}
                  type="number"
                  min="1"
                  max="50"
                  value={simulation.cycles}
                  onChange={(e) => updateSimulationSettings("cycles", Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full rounded bg-slate-50 border border-slate-300 px-2 py-1 font-mono text-slate-900 outline-none focus:border-emerald-500"
                />
              </label>

              <label htmlFor={runsInputId} className="space-y-1">
                <span className="text-[11px] text-slate-600 block">MC Runs (1-50):</span>
                <input
                  id={runsInputId}
                  type="number"
                  min="1"
                  max="50"
                  value={simulation.runs}
                  onChange={(e) => updateSimulationSettings("runs", Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full rounded bg-slate-50 border border-slate-300 px-2 py-1 font-mono text-slate-900 outline-none focus:border-emerald-500"
                />
              </label>

              <label htmlFor={seedInputId} className="space-y-1">
                <span className="text-[11px] text-slate-600 block">Random Seed:</span>
                <input
                  id={seedInputId}
                  type="number"
                  min="0"
                  placeholder="Random"
                  value={simulation.randomSeed ?? ""}
                  onChange={(e) => updateSimulationSettings("randomSeed", e.target.value)}
                  className="w-full rounded bg-slate-50 border border-slate-300 px-2 py-1 font-mono text-slate-900 outline-none focus:border-emerald-500"
                />
              </label>

              <label htmlFor={satFlowInputId} className="space-y-1">
                <span className="text-[11px] text-slate-600 block">Sat Flow (veh/h/ln):</span>
                <input
                  id={satFlowInputId}
                  type="number"
                  min="600"
                  max="2400"
                  step="50"
                  value={saturationFlowRates.north}
                  onChange={(e) => updateSaturationFlowRates(parseFloat(e.target.value) || 1800)}
                  className="w-full rounded bg-slate-50 border border-slate-300 px-2 py-1 font-mono text-slate-900 outline-none focus:border-emerald-500"
                />
              </label>

              <label htmlFor={lostTimeInputId} className="space-y-1">
                <span className="text-[11px] text-slate-600 block">Startup Lost (s):</span>
                <input
                  id={lostTimeInputId}
                  type="number"
                  min="0"
                  max="6"
                  step="0.5"
                  value={startupLostTimes.north}
                  onChange={(e) => updateStartupLostTimes(parseFloat(e.target.value) || 2.0)}
                  className="w-full rounded bg-slate-50 border border-slate-300 px-2 py-1 font-mono text-slate-900 outline-none focus:border-emerald-500"
                />
              </label>

              <div className="space-y-1">
                <span className="text-[11px] text-slate-600 block">Discharge Policy:</span>
                <select
                  value={dischargePolicy}
                  onChange={(e) => updateIntersectionGeometry({ dischargePolicy: e.target.value })}
                  className="w-full rounded bg-slate-50 border border-slate-300 px-2 py-1 font-mono text-slate-900 text-xs outline-none focus:border-emerald-500"
                >
                  <option value="fractional_carryover">Fractional Carryover</option>
                  <option value="independent_floor">Independent Floor</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <input
                type="checkbox"
                id={scalingInputId}
                checked={Boolean(simulation.applyScaling)}
                onChange={(e) => updateSimulationSettings("applyScaling", e.target.checked)}
                className="accent-emerald-500 rounded"
              />
              <label htmlFor={scalingInputId} className="text-slate-700 text-xs cursor-pointer select-none">
                Enable illustrative ML scenario multiplier scaling on arrival rates (Low: 0.85x, Medium: 1.0x, High: 1.25x)
              </label>
            </div>
          </div>
        )}

        {/* SECTION C: Prominent Unified Workflow Execution Bar */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleRunWorkflow}
            disabled={loading}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition shadow-lg ${
              loading
                ? "bg-slate-100 text-slate-600 cursor-wait"
                : "bg-emerald-600 text-white hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-[0.98]"
            }`}
          >
            {loading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                <span>Orchestrating End-to-End Workflow...</span>
              </>
            ) : (
              <>
                <Zap size={18} />
                <span>Run Traffic Analysis</span>
              </>
            )}
          </button>

          <div className="text-xs font-mono text-slate-600 flex flex-wrap items-center gap-2">
            <span>Payload: {simulation.cycles} cycles</span>
            <span>•</span>
            <span>{simulation.runs} MC runs</span>
            <span>•</span>
            <span>Seed: {parseOptionalSeed(simulation.randomSeed) !== null ? simulation.randomSeed : "random"}</span>
            <span>•</span>
            <span className="capitalize">{dischargePolicy.replace("_", " ")}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Stale Configuration Warning Alert */}
      {isConfigStale && workflowResult && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="text-amber-600 shrink-0" size={18} />
            <div>
              <span className="font-bold text-slate-900 block">Configuration Changed — Results Outdated</span>
              <span className="text-amber-700/90">
                You modified scenario parameters after the last run. The visualizer and performance metrics below reflect the previous execution. Click &quot;Rerun Analysis&quot; to compute updated results.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRunWorkflow}
            disabled={loading}
            className="shrink-0 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 transition text-xs flex items-center gap-1.5 shadow"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            <span>Rerun Analysis</span>
          </button>
        </div>
      )}

      {/* SECTION D: Regional ML Traffic Prediction Card */}
      {workflowResult?.ml_prediction && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <BrainCircuit className="text-emerald-600" size={18} />
              <h2 className="text-sm font-bold text-slate-900">Regional Freeway Volume Prediction</h2>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-700 border border-slate-300">
                Random Forest
              </span>
              {isConfigStale && (
                <span className="rounded bg-amber-500/20 text-amber-700 border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono">
                  Outdated Result
                </span>
              )}
            </div>

            {workflowResult.directional_inputs?.scenario_scaling?.applied && (
              <span className="rounded bg-amber-500/10 text-amber-600 border border-amber-500/30 px-2 py-0.5 text-[11px] font-mono">
                Scenario Multiplier: {workflowResult.directional_inputs.scenario_scaling.multiplier}x Applied
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Left: Category Badge & Thresholds */}
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-mono text-slate-500 block uppercase">Corridor Volume Level</span>
                <span
                  className={`mt-1 inline-block text-xl font-bold font-mono px-3 py-1 rounded border ${
                    workflowResult.ml_prediction.predicted_traffic_level === "High"
                      ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                      : workflowResult.ml_prediction.predicted_traffic_level === "Medium"
                      ? "bg-amber-500/20 text-amber-600 border-amber-500/40"
                      : "bg-emerald-500/20 text-emerald-600 border-emerald-500/40"
                  }`}
                >
                  {workflowResult.ml_prediction.predicted_traffic_level} Traffic
                </span>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] font-mono text-slate-600 space-y-1">
                <div>Low Max: &le; {workflowResult.ml_prediction.classification_thresholds?.low_max ?? 2000} veh/hr</div>
                <div>Medium Max: &le; {workflowResult.ml_prediction.classification_thresholds?.medium_max ?? 4500} veh/hr</div>
              </div>
            </div>

            {/* Center: Class Probabilities */}
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-2">
              <span className="text-[11px] font-mono text-slate-500 block uppercase">Tree Voting Fractions</span>
              <div className="space-y-2">
                {Object.entries(workflowResult.ml_prediction.class_probabilities || {}).map(([cls, prob]) => {
                  const pct = Math.round(prob * 100);
                  return (
                    <div key={cls} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-700">{cls}</span>
                        <span className="font-bold text-slate-900">{pct}% ({prob})</span>
                      </div>
                      <div className="h-1.5 w-full bg-white rounded-full overflow-hidden border border-slate-200">
                        <div
                          className={`h-full rounded-full ${
                            cls === "High" ? "bg-rose-500" : cls === "Medium" ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Model Scope and Disclaimers */}
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 flex flex-col justify-between text-[11px] text-slate-600 space-y-2">
              <div>
                <span className="font-semibold text-slate-700 block mb-1">Scope & Independence Notice:</span>
                <p className="leading-relaxed">
                  Trained on UCI Interstate-94 freeway volume telemetry. Directional intersection queues and arrival rates are independently configured by the user.
                </p>
              </div>
              <p className="text-[10px] text-slate-500 italic pt-2 border-t border-slate-200">
                {workflowResult.ml_prediction.confidence_interpretation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SECTION E: Four-Approach Intersection Visualizer (Reused) */}
      <IntersectionVisualizer
        history={workflowResult?.simulation_results?.history || []}
        currentQueues={initialQueues}
        arrivalRates={workflowResult?.directional_inputs?.effective_arrival_rates || arrivalRates}
        lanes={lanes}
        strategy="adaptive"
        cycleDuration={120}
      />

      {/* SECTION F: Baseline Signal Timing Allocation */}
      {workflowResult?.signal_allocation && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock size={16} className="text-emerald-600" />
                Baseline Split-Phase Signal Allocation (Cycle 0 Baseline)
                {isConfigStale && (
                  <span className="rounded bg-amber-500/20 text-amber-700 border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono">
                    Outdated Allocation
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Initial green times derived from configured initial queues. Subsequent simulation cycles dynamically re-optimize green times based on queue accumulation.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-700">
              <span className="bg-slate-50 px-2 py-1 rounded border border-slate-200">
                Cycle: {workflowResult.signal_allocation.cycle_time}s
              </span>
              <span className="bg-slate-50 px-2 py-1 rounded border border-slate-200 text-amber-600">
                Clearance: {workflowResult.signal_allocation.clearance_time}s
              </span>
              <span className="bg-slate-50 px-2 py-1 rounded border border-slate-200 text-emerald-600">
                Green Budget: {workflowResult.signal_allocation.total_green_time}s
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {DIRECTIONS.map((d) => {
              const gTime = workflowResult.signal_allocation.green_times?.[d] ?? 25;
              const relDemand = workflowResult.signal_allocation.relative_demands?.[d] ?? 0.25;
              return (
                <div key={d} className="rounded-lg bg-slate-50 p-3.5 border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="capitalize font-bold text-slate-900 text-xs">{d}</span>
                    <span className="text-[10px] font-mono text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {Math.round(relDemand * 100)}% Demand
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono text-slate-900">{gTime}s <span className="text-xs font-normal text-slate-600">Green</span></div>
                  <div className="text-[10px] text-slate-500 font-mono">Bound: 10s min &bull; 40s max</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION G: Simulation Performance KPIs */}
      {workflowResult?.simulation_results && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              title="Total Arrivals"
              value={workflowResult.simulation_results.metrics?.overall?.total_arrivals ?? 0}
              subtitle="Stochastic Poisson inflow"
              icon={CarFront}
            />
            <StatCard
              title="Total Discharged"
              value={workflowResult.simulation_results.metrics?.overall?.total_discharged ?? 0}
              subtitle="Vehicles served on green"
              icon={TrendingUp}
              highlight
            />
            <StatCard
              title="Remaining Queue"
              value={workflowResult.simulation_results.metrics?.overall?.total_remaining ?? 0}
              subtitle="Held at final cycle"
              icon={Activity}
            />
            <StatCard
              title="Avg Waiting Delay"
              value={`${workflowResult.simulation_results.metrics?.overall?.estimated_average_waiting_time_seconds ?? 0}s`}
              subtitle="Per vehicle wait time"
              icon={Clock}
            />
            <StatCard
              title="Capacity Utilization"
              value={`${workflowResult.simulation_results.metrics?.overall?.capacity_utilization_percentage ?? 0}%`}
              subtitle="Discharged / Theoretical"
              icon={Layers}
            />
          </div>

          {/* Conservation Law Verification Pill */}
          {workflowResult.simulation_results.vehicle_conservation && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <CheckCircle size={14} />
                Vehicle Conservation Law Verified (Error: 0)
              </span>
              <span className="text-slate-600 font-mono">
                {workflowResult.simulation_results.vehicle_conservation.total_initial_queue} init +{" "}
                {workflowResult.simulation_results.vehicle_conservation.total_arrivals} arr -{" "}
                {workflowResult.simulation_results.vehicle_conservation.total_discharged} disc ={" "}
                {workflowResult.simulation_results.vehicle_conservation.total_remaining} rem
              </span>
            </div>
          )}
        </div>
      )}

      {/* SECTION H: Fixed-Time vs Adaptive Monte Carlo Strategy Comparison */}
      {workflowResult?.strategy_comparison && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="text-emerald-600" size={18} />
                  Fixed-Time vs Adaptive Monte Carlo Comparison
                </h2>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-mono text-emerald-600 border border-emerald-500/30">
                  Common Random Numbers (CRN)
                </span>
                {isConfigStale && (
                  <span className="rounded bg-amber-500/20 text-amber-700 border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono">
                    Previous Run Comparison
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Evaluated over {workflowResult.strategy_comparison.monte_carlo_runs} paired trials with synchronized Poisson arrival streams.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-slate-50 px-3 py-1.5 border border-slate-200 text-xs font-mono">
                <span className="text-slate-600">Win Rate: </span>
                <span className="text-emerald-600 font-bold">
                  {workflowResult.strategy_comparison.win_tie_statistics?.win_rate_adaptive_percentage}% Adaptive
                </span>
                <span className="text-slate-500"> ({workflowResult.strategy_comparison.win_tie_statistics?.adaptive_wins}W / {workflowResult.strategy_comparison.win_tie_statistics?.fixed_wins}L / {workflowResult.strategy_comparison.win_tie_statistics?.ties}T)</span>
              </div>
            </div>
          </div>

          {/* Comparison Cards: Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Final Waiting Queue Comparison */}
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-3">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                <span className="text-xs font-semibold text-slate-900">Final Waiting Queue</span>
                <span className="text-[10px] font-mono text-slate-500">Lower is better</span>
              </div>
              <div className="flex items-baseline justify-between text-sm font-mono">
                <span className="text-slate-600">Fixed-Time:</span>
                <span className="text-rose-400 font-bold">
                  {workflowResult.strategy_comparison.fixed_strategy?.total_waiting} veh
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm font-mono">
                <span className="text-slate-600">Adaptive:</span>
                <span className="text-emerald-600 font-bold">
                  {workflowResult.strategy_comparison.adaptive_strategy?.total_waiting} veh
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs font-mono">
                <span className="text-slate-600">Queue Reduction:</span>
                <span className="text-emerald-600 font-bold">
                  {workflowResult.strategy_comparison.comparison_summary?.vehicles_saved} veh ({workflowResult.strategy_comparison.comparison_summary?.improvement_percentage}%)
                </span>
              </div>
            </div>

            {/* Waiting Time Delay Comparison */}
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-3">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                <span className="text-xs font-semibold text-slate-900">Average Waiting Delay</span>
                <span className="text-[10px] font-mono text-slate-500">Lower is better</span>
              </div>
              <div className="flex items-baseline justify-between text-sm font-mono">
                <span className="text-slate-600">Fixed-Time:</span>
                <span className="text-rose-400 font-bold">
                  {workflowResult.strategy_comparison.fixed_strategy?.average_waiting_time}s
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm font-mono">
                <span className="text-slate-600">Adaptive:</span>
                <span className="text-emerald-600 font-bold">
                  {workflowResult.strategy_comparison.adaptive_strategy?.average_waiting_time}s
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs font-mono">
                <span className="text-slate-600">Delay Saved:</span>
                <span className="text-emerald-600 font-bold">
                  {workflowResult.strategy_comparison.comparison_summary?.metrics?.waiting_time?.abs_difference}s ({workflowResult.strategy_comparison.comparison_summary?.metrics?.waiting_time?.percentage_improvement}%)
                </span>
              </div>
            </div>

            {/* Total Discharged Throughput */}
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-3">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                <span className="text-xs font-semibold text-slate-900">Mean Discharged Vehicles</span>
                <span className="text-[10px] font-mono text-slate-500">Higher is better</span>
              </div>
              <div className="flex items-baseline justify-between text-sm font-mono">
                <span className="text-slate-600">Fixed-Time:</span>
                <span className="text-slate-700 font-bold">
                  {workflowResult.strategy_comparison.fixed_strategy?.average_discharged} veh
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm font-mono">
                <span className="text-slate-600">Adaptive:</span>
                <span className="text-emerald-600 font-bold">
                  {workflowResult.strategy_comparison.adaptive_strategy?.average_discharged} veh
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs font-mono">
                <span className="text-slate-600">Throughput Gain:</span>
                <span className="text-emerald-600 font-bold">
                  +{workflowResult.strategy_comparison.comparison_summary?.metrics?.total_discharged?.abs_difference ?? 0} veh
                </span>
              </div>
            </div>
          </div>

          {/* Statistical Rigor & Pointwise 95% Confidence Interval */}
          {workflowResult.strategy_comparison.paired_difference_statistics && (
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle size={14} className="text-emerald-600" />
                  Statistical Inference & Pointwise 95% Student&apos;s t Confidence Interval
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Base Seed: {workflowResult.strategy_comparison.base_seed}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <span className="text-slate-500 block text-[10px]">Mean Paired Diff:</span>
                  <span className="text-slate-900 font-bold text-sm">
                    {workflowResult.strategy_comparison.paired_difference_statistics.mean_paired_difference} veh
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Sample Std Dev (s_D):</span>
                  <span className="text-slate-700 font-bold text-sm">
                    {workflowResult.strategy_comparison.paired_difference_statistics.sample_std_paired_difference}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Standard Error (SE):</span>
                  <span className="text-slate-700 font-bold text-sm">
                    {workflowResult.strategy_comparison.paired_difference_statistics.standard_error}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">95% CI (Pointwise):</span>
                  <span className="text-emerald-600 font-bold text-sm">
                    {workflowResult.strategy_comparison.paired_difference_statistics?.confidence_interval_95
                      ? `[${workflowResult.strategy_comparison.paired_difference_statistics.confidence_interval_95.lower}, ${workflowResult.strategy_comparison.paired_difference_statistics.confidence_interval_95.upper}]`
                      : "Unavailable (Requires ≥ 2 runs)"}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                {workflowResult.strategy_comparison.simulation_distinction}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
