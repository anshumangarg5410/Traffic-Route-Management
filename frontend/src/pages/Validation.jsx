import { useState, useEffect } from "react";
import {
  CheckCircle,
  XCircle,
  Sliders,
  ShieldCheck,
  Layers,
  Play,
  Info,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { getValidationScenarios, runSensitivityAnalysis } from "../services/api";

const PARAMETER_OPTIONS = [
  { value: "arrival_rate", label: "Arrival Rate (veh/min)", unit: "veh/min" },
  { value: "initial_queue", label: "Initial Queue (vehicles)", unit: "veh" },
  { value: "lanes", label: "Lane Count", unit: "lanes" },
  { value: "saturation_flow_rate", label: "Saturation Flow Rate (veh/hr/lane)", unit: "veh/hr/lane" },
  { value: "startup_lost_time", label: "Startup Lost Time (seconds)", unit: "sec" },
  { value: "cycles", label: "Simulation Cycles", unit: "cycles" },
];

function CustomTooltip({ active, payload, label, selectedParam }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const paramUnit = PARAMETER_OPTIONS.find((p) => p.value === selectedParam)?.unit || "";
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-xl backdrop-blur space-y-2">
        <div className="font-bold text-white border-b border-slate-800 pb-1">
          Parameter Value: {label} {paramUnit}
        </div>
        {payload.map((entry, idx) => (
          <div key={idx} className="flex flex-col text-[11px]" style={{ color: entry.color }}>
            <div className="flex justify-between gap-4 font-semibold">
              <span>{entry.name}:</span>
              <span>{entry.value}</span>
            </div>
            {entry.dataKey === "AdaptiveQueue" && data.adQueueCI && (
              <span className="text-[10px] text-slate-400">
                SD: ±{data.adQueueStd} veh | Pointwise 95% CI: [{data.adQueueCI[0]}, {data.adQueueCI[1]}] veh
              </span>
            )}
            {entry.dataKey === "FixedQueue" && data.fxQueueCI && (
              <span className="text-[10px] text-slate-400">
                SD: ±{data.fxQueueStd} veh | Pointwise 95% CI: [{data.fxQueueCI[0]}, {data.fxQueueCI[1]}] veh
              </span>
            )}
            {entry.dataKey === "AdaptiveWaitTime" && data.adWaitCI && (
              <span className="text-[10px] text-slate-400">
                SD: ±{data.adWaitStd}s | Pointwise 95% CI: [{data.adWaitCI[0]}, {data.adWaitCI[1]}]s
              </span>
            )}
            {entry.dataKey === "FixedWaitTime" && data.fxWaitCI && (
              <span className="text-[10px] text-slate-400">
                SD: ±{data.fxWaitStd}s | Pointwise 95% CI: [{data.fxWaitCI[0]}, {data.fxWaitCI[1]}]s
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export default function Validation() {
  const [activeTab, setActiveTab] = useState("validation"); // 'validation' | 'sensitivity'

  // Validation State
  const [validationReport, setValidationReport] = useState(null);
  const [valLoading, setValLoading] = useState(true);
  const [valError, setValError] = useState("");

  // Sensitivity State
  const [selectedParam, setSelectedParam] = useState("arrival_rate");
  const [targetDir, setTargetDir] = useState("all_directions");
  const [mcRuns, setMcRuns] = useState(30);
  const [sensitivityReport, setSensitivityReport] = useState(null);
  const [sensLoading, setSensLoading] = useState(true);
  const [sensError, setSensError] = useState("");

  const fetchValidation = async () => {
    setValLoading(true);
    setValError("");
    try {
      const data = await getValidationScenarios();
      setValidationReport(data);
    } catch (err) {
      setValError(err.message || "Failed to run validation scenarios.");
    } finally {
      setValLoading(false);
    }
  };

  const handleRunSensitivity = async () => {
    setSensLoading(true);
    setSensError("");
    try {
      const payload = {
        parameter_name: selectedParam,
        target_direction: targetDir === "all_directions" ? null : targetDir,
        compare_both_strategies: true,
        runs: mcRuns,
      };
      const data = await runSensitivityAnalysis(payload);
      setSensitivityReport(data);
    } catch (err) {
      setSensError(err.message || "Failed to run sensitivity analysis.");
    } finally {
      setSensLoading(false);
    }
  };

  // Initial load on mount without cascading synchronous setStates
  useEffect(() => {
    let ignore = false;

    const loadInitialData = async () => {
      try {
        const valData = await getValidationScenarios();
        if (!ignore) {
          setValidationReport(valData);
          setValLoading(false);
        }
      } catch (err) {
        if (!ignore) {
          setValError(err.message || "Failed to run validation scenarios.");
          setValLoading(false);
        }
      }

      try {
        const sensData = await runSensitivityAnalysis({
          parameter_name: "arrival_rate",
          target_direction: null,
          compare_both_strategies: true,
          runs: 30,
        });
        if (!ignore) {
          setSensitivityReport(sensData);
          setSensLoading(false);
        }
      } catch (err) {
        if (!ignore) {
          setSensError(err.message || "Failed to run sensitivity analysis.");
          setSensLoading(false);
        }
      }
    };

    loadInitialData();

    return () => {
      ignore = true;
    };
  }, []);

  // Format chart data for sensitivity
  const chartData = (sensitivityReport?.results || []).map((step) => {
    const ad = step.adaptive;
    const fx = step.fixed;
    return {
      name: `${step.parameter_value}`,
      val: step.parameter_value,
      // Mean values
      AdaptiveQueue: ad.final_queue_mean ?? ad.final_queue,
      FixedQueue: fx?.final_queue_mean ?? fx?.final_queue,
      AdaptiveDischarged: ad.total_discharged_mean ?? ad.total_discharged,
      FixedDischarged: fx?.total_discharged_mean ?? fx?.total_discharged,
      AdaptiveWaitTime: ad.average_waiting_time_mean ?? ad.average_waiting_time,
      FixedWaitTime: fx?.average_waiting_time_mean ?? fx?.average_waiting_time,
      AdaptiveUtil: ad.capacity_utilization_mean ?? ad.capacity_utilization,
      FixedUtil: fx?.capacity_utilization_mean ?? fx?.capacity_utilization,
      // Variance & CIs
      adQueueStd: ad.final_queue_std,
      fxQueueStd: fx?.final_queue_std,
      adQueueCI: ad.final_queue_ci95,
      fxQueueCI: fx?.final_queue_ci95,
      adWaitStd: ad.average_waiting_time_std,
      fxWaitStd: fx?.average_waiting_time_std,
      adWaitCI: ad.average_waiting_time_ci95,
      fxWaitCI: fx?.average_waiting_time_ci95,
    };
  });

  return (
    <div className="space-y-7">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Validation & Sensitivity Analysis</h1>
        <p className="mt-2 text-sm text-slate-400">
          Controlled deterministic verification scenarios, fractional capacity audit, and Monte Carlo parametric sensitivity sweeps with paired Common Random Numbers (CRN).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-4">
        <button
          onClick={() => setActiveTab("validation")}
          className={`flex items-center gap-2 pb-3 text-sm font-semibold transition ${
            activeTab === "validation"
              ? "border-b-2 border-emerald-400 text-emerald-400"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <ShieldCheck size={18} />
          Deterministic Scenarios & Policy Audit
        </button>

        <button
          onClick={() => setActiveTab("sensitivity")}
          className={`flex items-center gap-2 pb-3 text-sm font-semibold transition ${
            activeTab === "sensitivity"
              ? "border-b-2 border-emerald-400 text-emerald-400"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Sliders size={18} />
          Monte Carlo Sensitivity Sweeps
        </button>
      </div>

      {/* Tab 1: Validation Scenarios */}
      {activeTab === "validation" && (
        <div className="space-y-6">
          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div>
              <span className="text-xs text-slate-400">Overall Validation Status: </span>
              {validationReport ? (
                <span className="font-bold text-emerald-400">
                  {validationReport.passed_scenarios} / {validationReport.total_scenarios} SCENARIOS PASSED
                </span>
              ) : (
                <span className="text-slate-500">{valLoading ? "Executing Tests..." : "Pending Execution"}</span>
              )}
            </div>

            <button
              onClick={fetchValidation}
              disabled={valLoading}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              <Play size={14} />
              {valLoading ? "Running Test Scenarios..." : "Re-Run All Scenarios"}
            </button>
          </div>

          {valError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {valError}
            </div>
          )}

          {/* Scenarios Grid */}
          {validationReport && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {validationReport.scenarios.map((sc) => (
                <div
                  key={sc.scenario_id}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-semibold text-white text-sm flex items-center gap-2">
                      {sc.passed ? (
                        <CheckCircle size={16} className="text-emerald-400" />
                      ) : (
                        <XCircle size={16} className="text-red-400" />
                      )}
                      {sc.title}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase rounded px-2 py-0.5 ${
                        sc.passed
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20"
                      }`}
                    >
                      {sc.passed ? "VERIFIED" : "FAILED"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">{sc.description}</p>

                  <div className="rounded bg-slate-950 p-2.5 text-xs space-y-1">
                    <p className="text-[11px] text-slate-500">
                      <strong className="text-slate-400">Expected:</strong> {sc.expected}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-300 font-mono">
                      {Object.entries(sc.observed).map(([k, v]) => (
                        <div key={k} className="overflow-hidden text-ellipsis">
                          <span className="text-slate-500">{k}: </span>
                          <span className="text-emerald-400">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Discharge Policy Audit Card */}
          {validationReport?.discharge_policy_audit && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Layers size={18} className="text-emerald-400" />
                  {validationReport.discharge_policy_audit.title}
                </h3>
                <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                  Conservation Preserved
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                {/* Approach A */}
                <div className="rounded-lg bg-slate-950 p-4 border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-white">Approach A: Independent Floor</span>
                    <span className="text-sky-400 font-mono font-bold">
                      {validationReport.discharge_policy_audit.approach_a_independent_floor.total_discharged} veh discharged
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    {validationReport.discharge_policy_audit.approach_a_independent_floor.policy}
                  </p>
                  <p className="text-amber-400 text-[11px]">
                    Fractional Service Discarded:{" "}
                    <strong>{validationReport.discharge_policy_audit.approach_a_independent_floor.fractional_service_discarded} veh</strong>
                  </p>
                </div>

                {/* Approach B */}
                <div className="rounded-lg bg-slate-950 p-4 border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-white">Approach B: Fractional Carryover</span>
                    <span className="text-emerald-400 font-mono font-bold">
                      {validationReport.discharge_policy_audit.approach_b_fractional_carryover.total_discharged} veh discharged
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    {validationReport.discharge_policy_audit.approach_b_fractional_carryover.policy}
                  </p>
                  <p className="text-emerald-400 text-[11px]">
                    Fractional Service Discarded:{" "}
                    <strong>{validationReport.discharge_policy_audit.approach_b_fractional_carryover.fractional_service_discarded} veh</strong>
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-slate-950 p-3.5 text-xs text-slate-300 leading-relaxed border border-slate-800/80">
                <span className="font-semibold text-emerald-400">Engineering Trade-Off Analysis: </span>
                {validationReport.discharge_policy_audit.analysis}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Sensitivity Analysis */}
      {activeTab === "sensitivity" && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="font-semibold text-white text-sm">
                Monte Carlo One-At-A-Time (OAT) Sensitivity Sweep
              </h2>
              {sensitivityReport && (
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-[11px] font-mono text-emerald-400">
                  {sensitivityReport.runs} Replicates / Point (CRN Paired)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Parameter to Vary</label>
                <select
                  value={selectedParam}
                  onChange={(e) => setSelectedParam(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                >
                  {PARAMETER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Approach Scope</label>
                <select
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                >
                  <option value="all_directions">All Directions Simultaneously</option>
                  <option value="north">North Approach Only</option>
                  <option value="south">South Approach Only</option>
                  <option value="east">East Approach Only</option>
                  <option value="west">West Approach Only</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Monte Carlo Replicates (Runs)</label>
                <select
                  value={mcRuns}
                  onChange={(e) => setMcRuns(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                >
                  <option value={10}>10 Runs (Fast Exploration)</option>
                  <option value={30}>30 Runs (Default Standard)</option>
                  <option value={50}>50 Runs (High Precision)</option>
                  <option value={100}>100 Runs (Rigorous Benchmark)</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={handleRunSensitivity}
                  disabled={sensLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Play size={14} />
                  {sensLoading ? "Executing Monte Carlo..." : "Run Monte Carlo Sweep"}
                </button>
              </div>
            </div>
          </div>

          {sensError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {sensError}
            </div>
          )}

          {/* Sensitivity Charts */}
          {sensitivityReport && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Final Waiting Queue (Adaptive vs Fixed) */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Mean Remaining Queue vs. {PARAMETER_OPTIONS.find((p) => p.value === selectedParam)?.label}
                </h3>
                <p className="text-xs text-slate-400">
                  Mean vehicles remaining across {sensitivityReport.runs} Monte Carlo replicates with pointwise 95% Student's t CI.
                </p>
                <div className="h-64 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <RechartsTooltip content={<CustomTooltip selectedParam={selectedParam} />} />
                      <Legend />
                      <Line type="monotone" dataKey="AdaptiveQueue" name="Adaptive Queue (Mean)" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="FixedQueue" name="Fixed Queue (Mean)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Average Waiting Time */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Mean Waiting Time (s) vs. {PARAMETER_OPTIONS.find((p) => p.value === selectedParam)?.label}
                </h3>
                <p className="text-xs text-slate-400">
                  Mean delay per vehicle across {sensitivityReport.runs} replicates with pointwise 95% Student's t CI.
                </p>
                <div className="h-64 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <RechartsTooltip content={<CustomTooltip selectedParam={selectedParam} />} />
                      <Legend />
                      <Line type="monotone" dataKey="AdaptiveWaitTime" name="Adaptive Wait (Mean s)" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="FixedWaitTime" name="Fixed Wait (Mean s)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 3: Throughput (Total Discharged) */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Mean Throughput (Vehicles Discharged)
                </h3>
                <p className="text-xs text-slate-400">
                  Mean vehicles served through the intersection during {sensitivityReport.runs} simulation runs.
                </p>
                <div className="h-64 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend />
                      <Bar dataKey="AdaptiveDischarged" name="Adaptive Throughput (Mean)" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="FixedDischarged" name="Fixed Throughput (Mean)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 4: Capacity Utilization */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Mean Capacity Utilization (%)
                </h3>
                <p className="text-xs text-slate-400">
                  Mean percentage of theoretical discharge capacity utilized across {sensitivityReport.runs} runs.
                </p>
                <div className="h-64 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend />
                      <Line type="monotone" dataKey="AdaptiveUtil" name="Adaptive Util % (Mean)" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="FixedUtil" name="Fixed Util % (Mean)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Sweep Results Table */}
          {sensitivityReport && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">Monte Carlo Parameter Sweep Statistics</h3>
                  <p className="text-[11px] text-slate-400">
                    Sign convention: <span className="font-mono text-emerald-400">Fixed - Adaptive</span> (positive values indicate Adaptive strategy reduction / improvement).
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono rounded bg-slate-950 px-2.5 py-1 border border-slate-800">
                  Sample Size: N = {sensitivityReport.runs} replicates/point
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px]">
                    <tr>
                      <th className="p-3">Param Value</th>
                      <th className="p-3">Adaptive Queue (Mean ± SD)</th>
                      <th className="p-3">Fixed Queue (Mean ± SD)</th>
                      <th className="p-3">Paired Queue Diff (Pointwise 95% CI)</th>
                      <th className="p-3">Adaptive Wait (Mean ± SD)</th>
                      <th className="p-3">Fixed Wait (Mean ± SD)</th>
                      <th className="p-3">Paired Delay Diff (Pointwise 95% CI)</th>
                      <th className="p-3">Adaptive Util</th>
                      <th className="p-3">Fixed Util</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300 font-mono">
                    {sensitivityReport.results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-800/40">
                        <td className="p-3 text-white font-bold">{r.parameter_value}</td>
                        <td className="p-3 text-emerald-400">
                          {r.adaptive.final_queue_mean ?? r.adaptive.final_queue}
                          {r.adaptive.final_queue_std !== undefined && (
                            <span className="text-[10px] text-slate-400"> ± {r.adaptive.final_queue_std}</span>
                          )}
                        </td>
                        <td className="p-3 text-blue-400">
                          {r.fixed?.final_queue_mean ?? r.fixed?.final_queue}
                          {r.fixed?.final_queue_std !== undefined && (
                            <span className="text-[10px] text-slate-400"> ± {r.fixed?.final_queue_std}</span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-emerald-400">
                          <div>
                            {r.paired_differences?.final_queue ? (
                              <>
                                <span>
                                  {r.paired_differences.final_queue.mean_difference >= 0 ? "+" : ""}
                                  {r.paired_differences.final_queue.mean_difference} veh
                                </span>
                                <div className="text-[10px] text-slate-400 font-normal">
                                  CI: [{r.paired_differences.final_queue.ci_95[0]}, {r.paired_differences.final_queue.ci_95[1]}]
                                </div>
                              </>
                            ) : (
                              <span>+{r.vehicles_saved_mean ?? r.vehicles_saved} veh</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          {r.adaptive.average_waiting_time_mean ?? r.adaptive.average_waiting_time}s
                          {r.adaptive.average_waiting_time_std !== undefined && (
                            <span className="text-[10px] text-slate-400"> ± {r.adaptive.average_waiting_time_std}s</span>
                          )}
                        </td>
                        <td className="p-3">
                          {r.fixed?.average_waiting_time_mean ?? r.fixed?.average_waiting_time}s
                          {r.fixed?.average_waiting_time_std !== undefined && (
                            <span className="text-[10px] text-slate-400"> ± {r.fixed?.average_waiting_time_std}s</span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-emerald-400">
                          <div>
                            {r.paired_differences?.average_waiting_time ? (
                              <>
                                <span>
                                  {r.paired_differences.average_waiting_time.mean_difference >= 0 ? "+" : ""}
                                  {r.paired_differences.average_waiting_time.mean_difference}s
                                </span>
                                <div className="text-[10px] text-slate-400 font-normal">
                                  CI: [{r.paired_differences.average_waiting_time.ci_95[0]}, {r.paired_differences.average_waiting_time.ci_95[1]}]s
                                </div>
                              </>
                            ) : (
                              <span>+{r.delay_saved_seconds_mean ?? r.delay_saved_seconds}s</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          {r.adaptive.capacity_utilization_mean ?? r.adaptive.capacity_utilization}%
                        </td>
                        <td className="p-3">
                          {r.fixed?.capacity_utilization_mean ?? r.fixed?.capacity_utilization}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sensitivity Methodology Note */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Info size={15} className="text-emerald-400" />
              Monte Carlo Methodology & Common Random Numbers (CRN)
            </div>
            <p>
              Each point in the sensitivity sweep is evaluated across {sensitivityReport?.runs || mcRuns} stochastic Monte Carlo replicates using paired Common Random Numbers (CRN).
              For each replicate, identical Poisson arrival seeds are provided to both Fixed and Adaptive strategies, isolating structural algorithmic performance differences from stochastic sampling fluctuations.
            </p>
            <div className="rounded border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-300 space-y-1.5">
              <div className="font-semibold text-amber-200">
                Pointwise 95% Student&apos;s t Confidence Interval Interpretation:
              </div>
              <ul className="list-disc list-inside space-y-1 text-amber-200/90 ml-1">
                <li>
                  Reported intervals are <strong>pointwise 95% Student&apos;s t confidence intervals</strong> ($df = R - 1$) computed independently for each parameter setting.
                </li>
                <li>
                  They quantify simulation sampling uncertainty arising from stochastic Poisson vehicle arrivals under the model&apos;s macroscopic fluid-queue assumptions.
                </li>
                <li>
                  They are evaluated point-by-point and are <strong>not simultaneous confidence intervals</strong> across all parameter sweep values (no family-wise error rate or multiple-testing correction is applied).
                </li>
                <li>
                  They reflect mathematical simulation precision and <strong>do not establish empirical real-world traffic performance</strong> or field-calibrated intersection conditions.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
