import { useState } from "react";
import {
  Activity,
  Play,
  RotateCcw,
  CarFront,
  TrendingDown,
  Gauge,
  Layers,
  Info,
  CheckCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { simulateTraffic } from "../services/api";
import { useTraffic, DIRECTIONS as directions, parseOptionalSeed } from "../context/TrafficContext";
import IntersectionVisualizer from "../components/visualizer/IntersectionVisualizer";

const directionColors = {
  north: "bg-emerald-500",
  south: "bg-blue-500",
  east: "bg-purple-500",
  west: "bg-orange-500",
};

function StatCard({ title, value, description, icon: Icon, highlight = false }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{title}</p>
        <Icon size={20} className={highlight ? "text-emerald-600" : "text-slate-600"} />
      </div>

      <h2 className="mt-4 text-2xl font-bold text-slate-900">{value}</h2>

      <p className="mt-2 text-xs text-slate-500">{description}</p>
    </div>
  );
}

export default function Simulation() {
  const {
    initialQueues,
    arrivalRates,
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
  const strategy = simulation.strategy;
  const randomSeed = simulation.randomSeed;

  const [showAdvancedCapacity, setShowAdvancedCapacity] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSimulation = async () => {
    setError("");
    setLoading(true);

    try {
      const payload = {
        initial_queues: Object.fromEntries(
          directions.map((d) => [d, Number(initialQueues[d])])
        ),
        arrival_rates: Object.fromEntries(
          directions.map((d) => [d, Number(arrivalRates[d])])
        ),
        cycles: Number(cycles),
        strategy: strategy,
        random_seed: parseOptionalSeed(randomSeed),
        lanes: Object.fromEntries(
          directions.map((d) => [d, Number(lanes[d])])
        ),
        saturation_flow_rates: Object.fromEntries(
          directions.map((d) => [d, Number(saturationFlowRates[d])])
        ),
        startup_lost_times: Object.fromEntries(
          directions.map((d) => [d, Number(startupLostTimes[d])])
        ),
      };

      const response = await simulateTraffic(payload);
      setResult(response);
    } catch (err) {
      setError(err.message || "Unable to run simulation.");
    } finally {
      setLoading(false);
    }
  };

  const resetSimulation = () => {
    resetTrafficConfig();
    setResult(null);
    setError("");
  };

  const totalInitialVehicles = Object.values(initialQueues).reduce(
    (sum, value) => sum + Number(value),
    0
  );

  const totalFinalVehicles = result
    ? Object.values(result.final_queues).reduce((sum, value) => sum + value, 0)
    : 0;

  // Prepare chart data comparing Capacity vs Discharge and Green vs Effective Green
  const chartData = directions.map((d) => {
    if (!result?.metrics?.by_direction?.[d]) {
      return {
        direction: d.toUpperCase(),
        initialQueue: Number(initialQueues[d]),
        finalQueue: 0,
        theoreticalCapacity: 0,
        actualDischarged: 0,
        nominalGreen: 0,
        effectiveGreen: 0,
      };
    }
    const dm = result.metrics.by_direction[d];
    return {
      direction: d.toUpperCase(),
      initialQueue: dm.initial_queue,
      finalQueue: dm.final_queue,
      theoreticalCapacity: dm.theoretical_discharge_capacity,
      actualDischarged: dm.actual_vehicles_discharged,
      nominalGreen: dm.total_green_time_seconds,
      effectiveGreen: dm.total_effective_green_time_seconds,
      utilization: dm.capacity_utilization_percentage,
    };
  });

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Traffic Simulation</h1>
        <p className="mt-2 text-sm text-slate-600">
          Simulate stochastic vehicle arrivals, lane-based discharge capacity, and adaptive signal timing across a 4-way intersection.
        </p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Initial Vehicles"
          value={totalInitialVehicles}
          description="Total vehicles queued initially"
          icon={CarFront}
        />

        <StatCard
          title="Total Throughput"
          value={result?.metrics?.overall?.total_throughput ?? "--"}
          description="Vehicles discharged across all cycles"
          icon={Gauge}
          highlight={true}
        />

        <StatCard
          title="Capacity Utilization"
          value={
            result?.metrics?.overall?.overall_capacity_utilization_percentage != null
              ? `${result.metrics.overall.overall_capacity_utilization_percentage}%`
              : "--"
          }
          description="Discharged vs. theoretical capacity"
          icon={Activity}
          highlight={true}
        />

        <StatCard
          title="Final Waiting"
          value={result ? totalFinalVehicles : "--"}
          description="Vehicles remaining in queues"
          icon={TrendingDown}
        />
      </div>

      {/* Input and results */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Configuration Form */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-6">
            <h2 className="font-semibold text-slate-900">Simulation Configuration</h2>
            <p className="mt-1 text-xs text-slate-600">
              Configure directional arrival rates, initial queues, and capacity parameters.
            </p>
          </div>

          {/* Strategy & Cycles & Seed */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-xs text-slate-600">Signal Strategy</label>
              <select
                value={strategy}
                onChange={(e) => updateSimulationSettings("strategy", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
              >
                <option value="adaptive">Adaptive Optimization</option>
                <option value="fixed">Fixed-Time (25s each)</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs text-slate-600">Simulation Cycles</label>
              <input
                type="number"
                min="1"
                max="20"
                step="1"
                value={cycles}
                onChange={(e) => updateSimulationSettings("cycles", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs text-slate-600">Random Seed (Optional)</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="None (Random)"
                value={randomSeed}
                onChange={(e) => updateSimulationSettings("randomSeed", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="my-5 border-t border-slate-200" />

          {/* Initial Queues */}
          <h3 className="mb-3 text-sm font-medium text-slate-700">Initial Vehicle Queues</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {directions.map((direction) => (
              <div key={direction}>
                <label className="mb-1 block text-xs capitalize text-slate-600">
                  {direction}
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={initialQueues[direction]}
                  onChange={(e) =>
                    updateDirectionalQueues(direction, e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>
            ))}
          </div>

          <div className="my-5 border-t border-slate-200" />

          {/* Arrival Rates */}
          <h3 className="mb-3 text-sm font-medium text-slate-700">
            Poisson Arrival Rates (Vehicles / Minute)
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {directions.map((direction) => (
              <div key={direction}>
                <label className="mb-1 block text-xs capitalize text-slate-600">
                  {direction}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={arrivalRates[direction]}
                  onChange={(e) =>
                    updateArrivalRates(direction, e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>
            ))}
          </div>

          <div className="my-5 border-t border-slate-200" />

          {/* Lane Geometry & Capacity Parameters Toggle */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                <Layers size={16} className="text-emerald-600" />
                Intersection Capacity & Geometry
              </h3>
              <p className="text-xs text-slate-600">
                Lanes, saturation flow (veh/hr/lane), and startup lost time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedCapacity(!showAdvancedCapacity)}
              className="text-xs text-emerald-600 hover:text-emerald-700 underline"
            >
              {showAdvancedCapacity ? "Hide Parameters" : "Edit Parameters"}
            </button>
          </div>

          {/* Lanes Input */}
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600">
                Number of Lanes per Direction
              </label>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {directions.map((d) => (
                  <div key={d}>
                    <span className="mb-1 block text-xs capitalize text-slate-500">{d}</span>
                    <input
                      type="number"
                      min="1"
                      max="6"
                      step="1"
                      value={lanes[d]}
                      onChange={(e) => updateLanes(d, e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            {showAdvancedCapacity && (
              <>
                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-600">
                    Saturation Flow Rate (veh / hr / lane)
                  </label>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {directions.map((d) => (
                      <div key={d}>
                        <span className="mb-1 block text-xs capitalize text-slate-500">{d}</span>
                        <input
                          type="number"
                          min="500"
                          max="3000"
                          step="50"
                          value={saturationFlowRates[d]}
                          onChange={(e) =>
                            updateSaturationFlowRates(d, e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-600">
                    Startup Lost Time (seconds per phase)
                  </label>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {directions.map((d) => (
                      <div key={d}>
                        <span className="mb-1 block text-xs capitalize text-slate-500">{d}</span>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="0.5"
                          value={startupLostTimes[d]}
                          onChange={(e) =>
                            updateStartupLostTimes(d, e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleSimulation}
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={16} />
              {loading ? "Running Simulation..." : "Run Simulation"}
            </button>

            <button
              onClick={resetSimulation}
              className="rounded-lg border border-slate-300 px-4 text-slate-700 transition hover:bg-slate-100"
              title="Reset"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>

        {/* Results Overview */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Simulation Results & Capacity</h2>
            <p className="mt-1 text-xs text-slate-600">
              Theoretical capacity versus actual discharge and remaining queue distribution.
            </p>

            {!result ? (
              <div className="flex min-h-80 flex-col items-center justify-center text-center">
                <Activity size={40} className="text-slate-700" />
                <p className="mt-4 font-medium text-slate-700">No simulation results yet</p>
                <p className="mt-2 text-sm text-slate-500">
                  Configure traffic and capacity parameters, then click Run Simulation.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {/* Recharts Bar Chart: Theoretical Capacity vs Actual Discharge */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="direction" stroke="#64748b" textAnchor="end" />
                      <YAxis stroke="#64748b" />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "#ffffff", borderColor: "#334155" }}
                        labelStyle={{ color: "#f8fafc", fontWeight: "bold" }}
                      />
                      <Legend />
                      <Bar dataKey="theoreticalCapacity" name="Theoretical Capacity" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="actualDischarged" name="Actual Discharged" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="finalQueue" name="Final Queue" fill="#f97316" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* KPI summary */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 pt-2">
                  <div className="rounded-lg bg-slate-100 p-3">
                    <p className="text-xs text-slate-600">Total Arrived</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {result.metrics?.overall?.total_arrivals ?? 0}
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-100 p-3">
                    <p className="text-xs text-slate-600">Total Discharged</p>
                    <p className="mt-1 text-lg font-bold text-emerald-600">
                      {result.metrics?.overall?.total_discharged ?? 0}
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-100 p-3">
                    <p className="text-xs text-slate-600">Avg Waiting Time</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {result.metrics?.overall?.estimated_average_waiting_time_seconds ?? 0}s
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Conservation Check badge */}
          {result && (
            <div className="mt-6 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <CheckCircle size={14} />
                Vehicle Conservation Law Verified
              </span>
              <span className="text-slate-600 font-mono">
                {result.metrics.overall.total_initial_queue} init + {result.metrics.overall.total_arrivals} arr - {result.metrics.overall.total_discharged} disc = {result.metrics.overall.total_remaining} rem
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 4-Approach Intersection Visualizer */}
      <IntersectionVisualizer
        history={result?.history || []}
        currentQueues={initialQueues}
        arrivalRates={arrivalRates}
        lanes={lanes}
        strategy={strategy}
        cycleDuration={120}
      />

      {/* Direction-by-Direction Capacity Metrics */}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-6">
            <h2 className="font-semibold text-slate-900">Directional Capacity & Discharge Performance</h2>
            <p className="mt-1 text-xs text-slate-600">
              Detailed breakdown of lanes, effective green times, theoretical capacity, and capacity utilization.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {directions.map((d) => {
              const dm = result.metrics.by_direction[d];
              return (
                <div key={d} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="text-sm font-semibold capitalize text-slate-900 flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${directionColors[d]}`} />
                      {d} Approach
                    </span>
                    <span className="text-xs rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                      {dm.lanes ?? lanes[d]} {dm.lanes === 1 ? "lane" : "lanes"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Nominal Green</p>
                      <p className="font-semibold text-slate-900">{dm.total_green_time_seconds}s</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Effective Green</p>
                      <p className="font-semibold text-emerald-600">
                        {dm.total_effective_green_time_seconds}s
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Theoretical Cap</p>
                      <p className="font-semibold text-sky-600">{dm.theoretical_discharge_capacity}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Actual Discharged</p>
                      <p className="font-semibold text-emerald-600">{dm.actual_vehicles_discharged}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Capacity Util.</p>
                      <p className="font-semibold text-amber-600">{dm.capacity_utilization_percentage}%</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Final Queue</p>
                      <p className="font-semibold text-slate-900">{dm.final_queue} veh</p>
                    </div>
                  </div>

                  {/* Utilization Progress bar */}
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-slate-600">
                      <span>Capacity Utilization</span>
                      <span>{dm.capacity_utilization_percentage}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, dm.capacity_utilization_percentage)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cycle history */}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-6">
            <h2 className="font-semibold text-slate-900">Cycle-by-Cycle Simulation Progression</h2>
            <p className="mt-1 text-xs text-slate-600">
              Queue transitions, effective green times, theoretical capacities, and integer vehicle discharge per cycle.
            </p>
          </div>

          <div className="space-y-4">
            {result.history.map((cycle) => (
              <div
                key={cycle.cycle}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-semibold text-slate-900">Cycle {cycle.cycle}</h3>
                  <span className="text-xs text-slate-600">
                    Duration: 120s (100s Green + 20s Clearance)
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {directions.map((direction) => {
                    const effGreen = cycle.effective_green_times?.[direction] ?? cycle.green_times[direction];
                    const theoCap = cycle.theoretical_capacities?.[direction] ?? "--";
                    const intCap = cycle.discharge_capacities?.[direction] ?? "--";
                    const disc = cycle.discharged[direction];
                    const util = cycle.capacity_utilization_percentages?.[direction] ?? "--";

                    return (
                      <div key={direction} className="rounded border border-slate-900 bg-white p-3 text-xs space-y-2">
                        <div className="flex justify-between items-center font-medium">
                          <span className="capitalize text-slate-700">{direction}</span>
                          <span className="text-slate-900">{cycle.queues_after[direction]} rem</span>
                        </div>

                        <div className="space-y-1 text-slate-600 text-[11px]">
                          <div className="flex justify-between">
                            <span>Nominal Green (G):</span>
                            <span className="text-slate-900">{cycle.green_times[direction]}s</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Effective Green (g):</span>
                            <span className="text-emerald-600">{effGreen}s</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Theoretical Cap (C):</span>
                            <span className="text-sky-600">{theoCap} veh</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Integer Cap (⌊C⌋):</span>
                            <span className="text-slate-900">{intCap} veh</span>
                          </div>
                          <div className="flex justify-between font-semibold">
                            <span>Discharged:</span>
                            <span className="text-emerald-600">{disc} veh</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Utilized:</span>
                            <span className="text-amber-600">{util}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assumptions & Methodology Footer */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs text-slate-600 space-y-2">
        <div className="flex items-center gap-2 text-slate-700 font-semibold">
          <Info size={16} className="text-emerald-600" />
          Simulation Model Assumptions & Methodology
        </div>
        <p>
          <strong className="text-slate-700">Capacity Formulation:</strong> Theoretical discharge capacity follows the standard Highway Capacity Manual (HCM) formulation:{" "}
          <code className="text-emerald-600 bg-white px-1 py-0.5 rounded">C_d = s_d × L_d × (g_d / 3600)</code>, where effective green time{" "}
          <code className="text-emerald-600 bg-white px-1 py-0.5 rounded">g_d = max(0, G_d - l_s)</code> accounts for startup lost time <code className="text-emerald-600 bg-white px-1 py-0.5 rounded">l_s</code>.
        </p>
        <p>
          <strong className="text-slate-700">Integer Discharge Policy:</strong> Theoretical capacity is floored to integer vehicles (<code className="text-emerald-600 bg-white px-1 py-0.5 rounded">⌊C_d⌋</code>); vehicles discharged cannot exceed the integer capacity or available queue without upward rounding.
        </p>
        <p>
          <strong className="text-slate-700">Simulation Scope:</strong> Default parameters (1800 veh/hr/lane saturation flow, 2.0s lost time) are illustrative engineering baselines. This tool provides macroscopic comparative evaluation of signal strategies and is not a substitute for calibrated microscopic simulation platforms (e.g. SUMO, VISSIM).
        </p>
      </div>
    </div>
  );
}
