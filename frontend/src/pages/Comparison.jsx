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
import { compareStrategies } from "../services/api";
import { useTraffic, DIRECTIONS } from "../context/TrafficContext";

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  placeholder,
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs text-slate-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition focus:border-emerald-500"
      />
    </label>
  );
}

function MetricCard({ title, value, subtitle, highlight = false }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-400">{title}</p>
      <p
        className={`mt-2 text-2xl font-bold ${
          highlight ? "text-emerald-400" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function QueueBar({ label, value, maximum, color }) {
  const percentage =
    maximum > 0 ? Math.min((value / maximum) * 100, 100) : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{value} vehicles</span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs shadow-xl">
        <p className="font-semibold text-white mb-2">{label}</p>
        {payload.map((entry, index) => (
          <p key={`item-${index}`} style={{ color: entry.color }} className="mb-1">
            {entry.name}: <span className="font-bold">{entry.value}</span> vehicles
          </p>
        ))}
      </div>
    );
  }
  return null;
}

export default function Comparison() {
  const {
    initialQueues: queues,
    arrivalRates: arrivals,
    lanes,
    saturationFlowRates,
    startupLostTimes,
    simulation,
    updateDirectionalQueues,
    updateArrivalRates,
    updateLanes,
    updateSaturationFlowRates,
    updateStartupLostTimes,
    updateSimulationSettings,
    resetTrafficConfig,
  } = useTraffic();

  const cycles = simulation.cycles;
  const runs = simulation.runs;
  const seed = simulation.randomSeed;
  const satRate = saturationFlowRates.north;
  const lostTime = startupLostTimes.north;

  const [showCapacity, setShowCapacity] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const updateQueue = (direction, value) => {
    updateDirectionalQueues(direction, value);
  };

  const updateArrival = (direction, value) => {
    updateArrivalRates(direction, value);
  };

  const handleCompare = async (event) => {
    event.preventDefault();
    setError("");

    const parsedQueues = {};
    const parsedArrivals = {};

    for (const direction of DIRECTIONS) {
      const queue = Number(queues[direction]);
      const arrival = Number(arrivals[direction]);

      if (
        queues[direction] === "" ||
        !Number.isInteger(queue) ||
        queue < 0
      ) {
        setError(`Enter a valid non-negative integer for ${direction} vehicles.`);
        return;
      }

      if (
        arrivals[direction] === "" ||
        !Number.isFinite(arrival) ||
        arrival < 0
      ) {
        setError(`Enter a valid non-negative arrival rate for ${direction}.`);
        return;
      }

      parsedQueues[direction] = queue;
      parsedArrivals[direction] = arrival;
    }

    const parsedCycles = Number(cycles);
    if (
      cycles === "" ||
      !Number.isInteger(parsedCycles) ||
      parsedCycles < 1 ||
      parsedCycles > 20
    ) {
      setError("Simulation cycles must be an integer between 1 and 20.");
      return;
    }

    const parsedRuns = Number(runs);
    if (
      runs === "" ||
      !Number.isInteger(parsedRuns) ||
      parsedRuns < 1 ||
      parsedRuns > 50
    ) {
      setError("Simulation runs must be an integer between 1 and 50.");
      return;
    }

    let parsedSeed = undefined;
    if (seed !== null && seed !== undefined && String(seed).trim() !== "") {
      parsedSeed = Number(seed);
      if (!Number.isInteger(parsedSeed) || parsedSeed < 0) {
        setError("Random seed must be a non-negative integer.");
        return;
      }
    }

    setLoading(true);

    try {
      const payload = {
        initial_queues: parsedQueues,
        arrival_rates: parsedArrivals,
        cycles: parsedCycles,
        runs: parsedRuns,
        lanes: Object.fromEntries(DIRECTIONS.map((d) => [d, Number(lanes[d]) || 1])),
        saturation_flow_rates: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Number(satRate) || 1800])
        ),
        startup_lost_times: Object.fromEntries(
          DIRECTIONS.map((d) => [d, Number(lostTime) || 2.0])
        ),
      };

      if (parsedSeed !== undefined) {
        payload.random_seed = parsedSeed;
      }

      const response = await compareStrategies(payload);
      setResult(response);
    } catch (err) {
      setError(err.message || "Unable to compare strategies.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    resetTrafficConfig();
    setResult(null);
    setError("");
  };

  const fixedQueues = result?.fixed_strategy?.final_queues;
  const adaptiveQueues = result?.adaptive_strategy?.final_queues;

  const maximumQueue = result
    ? Math.max(
        1,
        ...DIRECTIONS.flatMap((direction) => [
          fixedQueues[direction] ?? 0,
          adaptiveQueues[direction] ?? 0,
        ])
      )
    : 1;

  const chartData = (result?.per_run_results || []).map((run) => ({
    name: `Run ${run.run}`,
    Fixed: run.fixed_final_waiting,
    Adaptive: run.adaptive_final_waiting,
  }));

  const reliability = result?.statistical_reliability;
  const compMetrics = result?.comparison?.metrics;

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Statistical Strategy Comparison
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Monte Carlo evaluation comparing Fixed-Time vs. Adaptive Signal
          Optimization using paired stochastic arrival streams.
        </p>
      </div>

      {/* Configuration Form */}
      <form
        onSubmit={handleCompare}
        className="rounded-xl border border-slate-800 bg-slate-900 p-5"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white">
              Monte Carlo Simulation Configuration
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Both strategies run under identical initial conditions and paired Poisson seeds per run.
            </p>
          </div>
          {result && (
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-mono text-emerald-400 border border-slate-700">
              Base Seed: {result.comparison.random_seed}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Initial queues */}
          <div>
            <h3 className="mb-4 text-xs font-semibold text-white">
              Initial Vehicle Queues
            </h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {DIRECTIONS.map((direction) => (
                <NumberField
                  key={direction}
                  label={`${direction[0].toUpperCase()}${direction.slice(1)} Vehicles`}
                  value={queues[direction]}
                  onChange={(value) => updateQueue(direction, value)}
                />
              ))}
            </div>
          </div>

          {/* Arrival rates */}
          <div>
            <h3 className="mb-4 text-xs font-semibold text-white">
              Vehicle Arrival Rates (per minute)
            </h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {DIRECTIONS.map((direction) => (
                <NumberField
                  key={direction}
                  label={`${direction[0].toUpperCase()}${direction.slice(1)} Arrival Rate`}
                  value={arrivals[direction]}
                  step={0.1}
                  onChange={(value) => updateArrival(direction, value)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Multi-Run & Seed Parameters */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 border-t border-slate-800 pt-6">
          <NumberField
            label="Simulation Cycles"
            value={cycles}
            min={1}
            max={20}
            onChange={(v) => updateSimulationSettings("cycles", v)}
          />

          <NumberField
            label="Monte Carlo Runs"
            value={runs}
            min={1}
            max={50}
            onChange={(v) => updateSimulationSettings("runs", v)}
          />

          <NumberField
            label="Base Random Seed"
            value={seed}
            min={0}
            placeholder="Optional (auto-generated)"
            onChange={(v) => updateSimulationSettings("randomSeed", v)}
          />
        </div>

        {/* Optional Capacity Configuration */}
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Lane & Capacity Parameters (identical across strategies)
            </span>
            <button
              type="button"
              onClick={() => setShowCapacity(!showCapacity)}
              className="text-xs text-emerald-400 hover:text-emerald-300 underline"
            >
              {showCapacity ? "Hide Capacity Settings" : "Configure Lanes & Saturation"}
            </button>
          </div>

          {showCapacity && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 bg-slate-950/60 p-4 rounded-lg border border-slate-800">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Lanes (N / S / E / W)</label>
                <div className="grid grid-cols-4 gap-1">
                  {DIRECTIONS.map((d) => (
                    <input
                      key={d}
                      type="number"
                      min="1"
                      max="6"
                      value={lanes[d]}
                      onChange={(e) => updateLanes(d, e.target.value)}
                      className="w-full rounded border border-slate-800 bg-slate-900 p-1 text-center text-xs text-white"
                      title={`${d} lanes`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Saturation Flow (veh/hr/lane)</label>
                <input
                  type="number"
                  min="500"
                  max="3000"
                  step="50"
                  value={satRate}
                  onChange={(e) => updateSaturationFlowRates(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Startup Lost Time (s)</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={lostTime}
                  onChange={(e) => updateStartupLostTimes(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Simulating Multi-Run Monte Carlo..." : "Run Statistical Comparison"}
          </button>

          <button
            type="button"
            onClick={resetForm}
            disabled={loading}
            title="Reset configuration"
            className="rounded-lg border border-slate-700 px-4 text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            ↻
          </button>
        </div>
      </form>

      {/* Results */}
      {result && (
        <>
          {/* Primary KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              title="Average Final Waiting"
              value={`${result.adaptive_strategy.total_waiting} veh`}
              subtitle={`Fixed: ${result.fixed_strategy.total_waiting} (${result.comparison.vehicles_saved} saved)`}
              highlight
            />

            <MetricCard
              title="Average Waiting Time"
              value={`${result.adaptive_strategy.average_waiting_time ?? "--"}s`}
              subtitle={`Fixed: ${result.fixed_strategy.average_waiting_time ?? "--"}s (${compMetrics?.waiting_time?.improvement_percentage ?? 0}% change)`}
            />

            <MetricCard
              title="Average Discharged"
              value={`${result.adaptive_strategy.average_discharged ?? "--"} veh`}
              subtitle={`Fixed: ${result.fixed_strategy.average_discharged ?? "--"} veh (${compMetrics?.total_discharged?.improvement_percentage ?? 0}% change)`}
            />

            <MetricCard
              title="Capacity Utilization"
              value={`${result.adaptive_strategy.average_capacity_utilization ?? "--"}%`}
              subtitle={`Fixed: ${result.fixed_strategy.average_capacity_utilization ?? "--"}% (${compMetrics?.capacity_utilization?.improvement_percentage ?? 0}% change)`}
            />

            <MetricCard
              title="Statistical Reliability"
              value={`${reliability?.adaptive_wins ?? 0}/${reliability?.total_runs ?? 0} wins`}
              subtitle={`Adaptive Win Rate: ${reliability?.win_rate_adaptive_percentage ?? 0}%`}
              highlight={reliability?.adaptive_wins >= (reliability?.fixed_wins ?? 0)}
            />
          </div>

          {/* Monte Carlo Run Breakdown Chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="mb-4">
                <h2 className="font-semibold text-white">
                  Per-Run Waiting Vehicles Comparison
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Total waiting vehicles at the end of each simulation run under identical paired arrivals.
                </p>
              </div>

              <div className="h-72 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      wrapperStyle={{ paddingTop: "15px", fontSize: "12px" }}
                    />
                    <Bar
                      dataKey="Fixed"
                      fill="#3b82f6"
                      name="Fixed Strategy Waiting"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="Adaptive"
                      fill="#10b981"
                      name="Adaptive Strategy Waiting"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Statistical Variability & Direction-Wise Comparison */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Variability metrics */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="font-semibold text-white">
                Variance & Statistical Dispersion
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Performance spread across {reliability?.total_runs} Monte Carlo trials.
              </p>

              <div className="mt-5 space-y-4 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Final Queue Std. Deviation (σ)</span>
                  <span className="font-mono text-white">
                    Fixed: <span className="text-blue-400">{reliability?.standard_deviations?.fixed_final_waiting ?? "--"}</span> | Adaptive: <span className="text-emerald-400">{reliability?.standard_deviations?.adaptive_final_waiting ?? "--"}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Waiting Time Std. Deviation (σ)</span>
                  <span className="font-mono text-white">
                    Fixed: <span className="text-blue-400">{reliability?.standard_deviations?.fixed_waiting_time ?? "--"}s</span> | Adaptive: <span className="text-emerald-400">{reliability?.standard_deviations?.adaptive_waiting_time ?? "--"}s</span>
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Observed Final Queue Range</span>
                  <span className="font-mono text-white">
                    Fixed: [{reliability?.ranges?.fixed_final_waiting?.min}, {reliability?.ranges?.fixed_final_waiting?.max}] | Adaptive: [{reliability?.ranges?.adaptive_final_waiting?.min}, {reliability?.ranges?.adaptive_final_waiting?.max}]
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Win / Loss / Tie Record</span>
                  <span className="font-mono text-white">
                    Adaptive {reliability?.adaptive_wins}W - {reliability?.fixed_wins}L - {reliability?.ties}T
                  </span>
                </div>

                <div className="rounded-lg bg-slate-950 p-3 text-slate-400">
                  <p className="text-[11px] leading-relaxed">
                    {reliability?.note}
                  </p>
                </div>
              </div>
            </div>

            {/* Direction-wise queue comparison */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="mb-6">
                <h2 className="font-semibold text-white">
                  Direction-Wise Average Final Queues
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Average waiting vehicles in each direction after {cycles} cycles.
                </p>
              </div>

              <div className="space-y-6">
                {DIRECTIONS.map((direction) => (
                  <div key={direction}>
                    <h3 className="mb-3 text-xs font-semibold capitalize text-white">
                      {direction}
                    </h3>

                    <div className="space-y-3">
                      <QueueBar
                        label="Fixed Strategy"
                        value={fixedQueues?.[direction] ?? 0}
                        maximum={maximumQueue}
                        color="bg-blue-500"
                      />

                      <QueueBar
                        label="Adaptive Strategy"
                        value={adaptiveQueues?.[direction] ?? 0}
                        maximum={maximumQueue}
                        color="bg-emerald-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-7 flex flex-wrap gap-5 border-t border-slate-800 pt-5">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                  Fixed Strategy
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                  Adaptive Strategy
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 px-5 py-10 text-center">
          <h3 className="font-medium text-slate-300">
            Ready for statistical strategy comparison?
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            Configure traffic parameters, cycle count, and number of Monte Carlo runs above.
          </p>
        </div>
      )}
    </div>
  );
}
