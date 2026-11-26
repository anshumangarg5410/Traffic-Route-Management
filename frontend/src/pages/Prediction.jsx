import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { predictTraffic, runIntegratedPrediction } from "../services/api";
import { useTraffic, DIRECTIONS } from "../context/TrafficContext";
import {
  Activity,
  BrainCircuit,
  Sliders,
  Play,
  RotateCcw,
  Clock,
  CarFront,
  Zap,
  Info,
} from "lucide-react";

const initialWeatherForm = {
  holiday: "None",
  temp: 290,
  rain_1h: 0,
  snow_1h: 0,
  clouds_all: 20,
  weather_main: "Clear",
  hour: 18,
  day: 23,
  month: 11,
  day_of_week: 0,
  is_weekend: 0,
};

function NumberInput({ label, value, onChange, min, max, step = 1, placeholder }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs text-slate-600">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-emerald-500"
      />
    </label>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, highlight = false }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">{title}</p>
        {Icon && <Icon size={18} className={highlight ? "text-emerald-600" : "text-slate-500"} />}
      </div>
      <p className={`mt-2 text-2xl font-bold ${highlight ? "text-emerald-600" : "text-slate-900"}`}>
        {value}
      </p>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

export default function Prediction() {
  const {
    initialQueues: queues,
    arrivalRates: arrivals,
    simulation,
    updateDirectionalQueues,
    updateArrivalRates,
    updateSimulationSettings,
    resetTrafficConfig,
  } = useTraffic();

  const [weatherForm, setWeatherForm] = useState(initialWeatherForm);
  const cycles = simulation.cycles;
  const strategy = simulation.strategy;
  const seed = simulation.randomSeed;
  const applyScaling = simulation.applyScaling;

  const [mlResult, setMlResult] = useState(null);
  const [integratedResult, setIntegratedResult] = useState(null);
  const [loadingMode, setLoadingMode] = useState(null); // 'ml' | 'integrated' | null
  const [error, setError] = useState("");

  const handleWeatherChange = (e) => {
    const { name, value } = e.target;
    setWeatherForm((prev) => ({
      ...prev,
      [name]: [
        "temp", "rain_1h", "snow_1h", "clouds_all",
        "hour", "day", "month", "day_of_week", "is_weekend"
      ].includes(name)
        ? Number(value)
        : value,
    }));
  };

  const handleQueueChange = (dir, val) => {
    updateDirectionalQueues(dir, val);
  };

  const handleArrivalChange = (dir, val) => {
    updateArrivalRates(dir, val);
  };

  const handlePredictOnly = async (e) => {
    e.preventDefault();
    setLoadingMode("ml");
    setError("");

    try {
      const response = await predictTraffic(weatherForm);
      setMlResult(response);
    } catch (err) {
      setError(err.message || "Failed to obtain ML prediction.");
    } finally {
      setLoadingMode(null);
    }
  };

  const handleRunIntegrated = async (e) => {
    e.preventDefault();
    setLoadingMode("integrated");
    setError("");

    const parsedQueues = {};
    const parsedArrivals = {};

    for (const d of DIRECTIONS) {
      const q = Number(queues[d]);
      const a = Number(arrivals[d]);
      if (queues[d] === "" || !Number.isInteger(q) || q < 0) {
        setError(`Enter a valid non-negative integer for ${d} vehicles.`);
        setLoadingMode(null);
        return;
      }
      if (arrivals[d] === "" || !Number.isFinite(a) || a < 0) {
        setError(`Enter a valid non-negative arrival rate for ${d}.`);
        setLoadingMode(null);
        return;
      }
      parsedQueues[d] = q;
      parsedArrivals[d] = a;
    }

    const parsedCycles = Number(cycles);
    if (!Number.isInteger(parsedCycles) || parsedCycles < 1 || parsedCycles > 20) {
      setError("Simulation cycles must be an integer between 1 and 20.");
      setLoadingMode(null);
      return;
    }

    let parsedSeed = undefined;
    if (seed !== null && seed !== undefined && String(seed).trim() !== "") {
      parsedSeed = Number(seed);
      if (!Number.isInteger(parsedSeed) || parsedSeed < 0) {
        setError("Random seed must be a non-negative integer.");
        setLoadingMode(null);
        return;
      }
    }

    try {
      const payload = {
        ...weatherForm,
        initial_queues: parsedQueues,
        arrival_rates: parsedArrivals,
        cycles: parsedCycles,
        strategy: strategy,
        apply_ml_scenario_scaling: applyScaling,
      };

      if (parsedSeed !== undefined) {
        payload.random_seed = parsedSeed;
      }

      const response = await runIntegratedPrediction(payload);
      setIntegratedResult(response);
      setMlResult(response.ml_context);
    } catch (err) {
      setError(err.message || "Failed to run integrated prediction and simulation.");
    } finally {
      setLoadingMode(null);
    }
  };

  const resetAll = () => {
    setWeatherForm(initialWeatherForm);
    resetTrafficConfig();
    setMlResult(null);
    setIntegratedResult(null);
    setError("");
  };

  const sim = integratedResult?.simulation_results;
  const overallMetrics = sim?.metrics?.overall;
  const byDirMetrics = sim?.metrics?.by_direction;

  const chartData = DIRECTIONS.map((d) => ({
    direction: d.toUpperCase(),
    Initial: Number(queues[d]) || 0,
    Final: sim?.final_queues?.[d] ?? 0,
    GreenTime: sim?.history?.[sim.history.length - 1]?.green_times?.[d] ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          ML Traffic Prediction & Signal Optimization Workflow
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Predict regional traffic volume categories from environmental features and evaluate
          micro-level intersection queue dynamics using stochastic simulation.
        </p>
      </div>

      {/* Main Grid: Inputs vs ML Context */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Input Parameters Form */}
        <div className="xl:col-span-2 space-y-6">
          <form className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
            {/* Step 1: Weather & Environment */}
            <div>
              <div className="mb-4 flex items-center gap-2 border-b border-slate-200 pb-3">
                <BrainCircuit className="text-emerald-600" size={20} />
                <h2 className="font-semibold text-slate-900">
                  1. Environmental & Temporal Features (ML Context)
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                <NumberInput
                  label="Temperature (K)"
                  value={weatherForm.temp}
                  min={100}
                  max={350}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, temp: Number(v) }))}
                />
                <NumberInput
                  label="Rainfall (mm)"
                  value={weatherForm.rain_1h}
                  min={0}
                  step={0.1}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, rain_1h: Number(v) }))}
                />
                <NumberInput
                  label="Snowfall (mm)"
                  value={weatherForm.snow_1h}
                  min={0}
                  step={0.1}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, snow_1h: Number(v) }))}
                />
                <NumberInput
                  label="Cloud Cover (%)"
                  value={weatherForm.clouds_all}
                  min={0}
                  max={100}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, clouds_all: Number(v) }))}
                />
                <NumberInput
                  label="Hour of Day (0–23)"
                  value={weatherForm.hour}
                  min={0}
                  max={23}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, hour: Number(v) }))}
                />
                <NumberInput
                  label="Day of Month (1–31)"
                  value={weatherForm.day}
                  min={1}
                  max={31}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, day: Number(v) }))}
                />
                <NumberInput
                  label="Month (1–12)"
                  value={weatherForm.month}
                  min={1}
                  max={12}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, month: Number(v) }))}
                />
                <NumberInput
                  label="Day of Week (0=Mon, 6=Sun)"
                  value={weatherForm.day_of_week}
                  min={0}
                  max={6}
                  onChange={(v) => setWeatherForm((p) => ({ ...p, day_of_week: Number(v) }))}
                />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block text-xs text-slate-600">Weather Condition</span>
                  <select
                    name="weather_main"
                    value={weatherForm.weather_main}
                    onChange={handleWeatherChange}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    {["Clear", "Clouds", "Rain", "Drizzle", "Mist", "Snow", "Fog", "Thunderstorm"].map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs text-slate-600">Holiday Status</span>
                  <input
                    type="text"
                    name="holiday"
                    value={weatherForm.holiday}
                    onChange={handleWeatherChange}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs text-slate-600">Weekend?</span>
                  <select
                    name="is_weekend"
                    value={weatherForm.is_weekend}
                    onChange={handleWeatherChange}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value={0}>Weekday (0)</option>
                    <option value={1}>Weekend (1)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Step 2: Directional Intersection Parameters */}
            <div className="border-t border-slate-200 pt-6">
              <div className="mb-4 flex items-center gap-2 border-b border-slate-200 pb-3">
                <Sliders className="text-emerald-600" size={20} />
                <h2 className="font-semibold text-slate-900">
                  2. Directional Intersection Demand (Micro Parameters)
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Initial queues */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold text-slate-700">
                    Initial Approach Queues (vehicles)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {DIRECTIONS.map((d) => (
                      <NumberInput
                        key={d}
                        label={`${d.toUpperCase()} Queue`}
                        value={queues[d]}
                        min={0}
                        onChange={(v) => handleQueueChange(d, v)}
                      />
                    ))}
                  </div>
                </div>

                {/* Arrival rates */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold text-slate-700">
                    Arrival Rates (vehicles / minute)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {DIRECTIONS.map((d) => (
                      <NumberInput
                        key={d}
                        label={`${d.toUpperCase()} Rate`}
                        value={arrivals[d]}
                        min={0}
                        step={0.1}
                        onChange={(v) => handleArrivalChange(d, v)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Simulation settings */}
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberInput
                  label="Simulation Cycles"
                  value={cycles}
                  min={1}
                  max={20}
                  onChange={(v) => updateSimulationSettings("cycles", v)}
                />

                <label className="block">
                  <span className="mb-2 block text-xs text-slate-600">Signal Strategy</span>
                  <select
                    value={strategy}
                    onChange={(e) => updateSimulationSettings("strategy", e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="adaptive">Adaptive Optimization</option>
                    <option value="fixed">Fixed-Time (25s each)</option>
                  </select>
                </label>

                <NumberInput
                  label="Random Seed (Optional)"
                  value={seed}
                  min={0}
                  placeholder="Optional (random)"
                  onChange={(v) => updateSimulationSettings("randomSeed", v)}
                />
              </div>

              {/* Scenario Scaling Option */}
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  id="scaling"
                  checked={applyScaling}
                  onChange={(e) => updateSimulationSettings("applyScaling", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 bg-white text-emerald-500 focus:ring-emerald-500"
                />
                <label htmlFor="scaling" className="text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">Apply ML Scenario Demand Factor</span> — Scale directional arrival rates based on predicted traffic category (Low: 0.85x, Medium: 1.0x, High: 1.25x).
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    Optional scenario assumption; not a direct learned directional output of the ML model.
                  </span>
                </label>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={handlePredictOnly}
                disabled={loadingMode !== null}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
              >
                <BrainCircuit size={16} />
                {loadingMode === "ml" ? "Predicting..." : "Predict Regional Traffic Only"}
              </button>

              <button
                type="button"
                onClick={handleRunIntegrated}
                disabled={loadingMode !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
              >
                <Play size={16} />
                {loadingMode === "integrated" ? "Simulating Workflow..." : "Run Integrated Prediction & Simulation"}
              </button>

              <button
                type="button"
                onClick={resetAll}
                className="rounded-lg border border-slate-300 px-4 text-slate-700 transition hover:bg-slate-100"
                title="Reset all inputs"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </form>
        </div>

        {/* ML Prediction Output Card */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <BrainCircuit className="text-emerald-600" size={20} />
                <h2 className="font-semibold text-slate-900">ML Regional Context</h2>
              </div>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 border border-slate-300">
                Random Forest
              </span>
            </div>

            {!mlResult ? (
              <div className="py-12 text-center text-slate-500">
                <BrainCircuit size={40} className="mx-auto mb-3 opacity-30 text-slate-600" />
                <p className="text-sm">Submit environmental conditions to predict macro traffic volume.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <p className="text-xs text-slate-600">Predicted Macro Traffic Volume</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span
                      className={`rounded-lg px-3 py-1.5 text-lg font-bold ${
                        mlResult.predicted_traffic_level === "High"
                          ? "bg-red-500/20 text-red-600 border border-red-500/30"
                          : mlResult.predicted_traffic_level === "Medium"
                          ? "bg-amber-500/20 text-amber-600 border border-amber-500/30"
                          : "bg-emerald-500/20 text-emerald-600 border border-emerald-500/30"
                      }`}
                    >
                      {mlResult.predicted_traffic_level}
                    </span>
                    <span className="text-xs text-slate-600">
                      Volume Index: {mlResult.predicted_traffic_level === "High" ? "> 4547 veh/h" : mlResult.predicted_traffic_level === "Low" ? "< 2157 veh/h" : "2157–4547 veh/h"}
                    </span>
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-xs font-semibold text-slate-700">
                    Classification Probabilities
                  </p>
                  <div className="space-y-3">
                    {Object.entries(mlResult.confidence || {}).map(([label, prob]) => (
                      <div key={label}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-mono text-slate-900">{(prob * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              label === "High" ? "bg-red-500" : label === "Medium" ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${prob * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 border border-slate-200">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1">
                    <Info size={13} className="text-emerald-600" />
                    Model Scope & Boundaries
                  </div>
                  Trained on UCI Interstate Traffic Volume data. This model classifies macro-level highway corridor traffic volume. It does not predict directional turning movements or queues at specific intersection approaches.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Integrated Simulation Results Section */}
      {integratedResult && (
        <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Intersection Simulation Results
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Stochastic queue progression across {sim?.cycles_simulated} cycles using {sim?.strategy} strategy.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-mono text-emerald-600 border border-slate-300">
                Strategy: {sim?.strategy?.toUpperCase()}
              </span>
              {sim?.random_seed !== null && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-mono text-slate-700 border border-slate-300">
                  Seed: {sim?.random_seed}
                </span>
              )}
            </div>
          </div>

          {/* KPI Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Final Waiting Vehicles"
              value={overallMetrics?.total_remaining ?? "--"}
              subtitle={`Initial queue: ${overallMetrics?.total_initial_queue ?? 0} veh`}
              icon={CarFront}
              highlight
            />
            <StatCard
              title="Total Vehicles Discharged"
              value={overallMetrics?.total_discharged ?? "--"}
              subtitle={`Arrived: ${overallMetrics?.total_arrivals ?? 0} veh`}
              icon={Zap}
            />
            <StatCard
              title="Average Queue Length"
              value={`${overallMetrics?.average_queue_length ?? "--"} veh`}
              subtitle={`Peak queue: ${overallMetrics?.maximum_queue_length ?? 0} veh`}
              icon={Activity}
            />
            <StatCard
              title="Estimated Waiting Time"
              value={`${overallMetrics?.estimated_average_waiting_time_seconds ?? "--"}s`}
              subtitle="Cycle-average queue accumulation"
              icon={Clock}
            />
          </div>

          {/* Recharts Chart: Initial vs Final vs Green Time */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">
              Direction-Wise Queues & Signal Allocations
            </h3>
            <p className="mb-4 text-xs text-slate-600">
              Comparing initial approach queues, final queues, and last-cycle green time allocations.
            </p>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="direction" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", borderRadius: "8px" }}
                  />
                  <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                  <Bar dataKey="Initial" fill="#64748b" name="Initial Queue (veh)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Final" fill="#3b82f6" name="Final Queue (veh)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="GreenTime" fill="#10b981" name="Allocated Green (sec)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Directional Details Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DIRECTIONS.map((d) => {
              const dm = byDirMetrics?.[d];
              return (
                <div key={d} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-xs font-bold uppercase text-emerald-600 mb-3">{d} Approach</h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Initial Queue:</span>
                      <span className="font-mono text-slate-900">{dm?.initial_queue ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Total Arrivals:</span>
                      <span className="font-mono text-slate-900">{dm?.total_arrivals ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Total Discharged:</span>
                      <span className="font-mono text-slate-900">{dm?.total_discharged ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Remaining Queue:</span>
                      <span className="font-mono font-bold text-slate-900">{dm?.final_queue ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-2">
                      <span>Avg Green Time:</span>
                      <span className="font-mono text-emerald-600">{dm?.average_green_time_seconds ?? 0}s</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Avg Waiting Time:</span>
                      <span className="font-mono text-slate-900">{dm?.estimated_average_waiting_time_seconds ?? 0}s</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Metadata Disclaimer */}
          <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-600 border border-slate-200">
            <p className="font-semibold text-slate-700 mb-1">Methodology & Scenario Note:</p>
            {integratedResult.scenario_metadata?.note}
          </div>
        </div>
      )}
    </div>
  );
}
