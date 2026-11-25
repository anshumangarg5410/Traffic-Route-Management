import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  UserX,
  ShieldCheck,
  Cpu,
  Network,
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Server,
  Info,
  Shield,
  Layers,
  MapPin,
} from "lucide-react";
import {
  getAdminOverview,
  getAdminWorkers,
  getRoutingNetworkSummary,
} from "../../services/api";

function formatTimestamp(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export default function AdminOverview() {
  const [overview, setOverview] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [networkSummary, setNetworkSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  useEffect(() => {
    let ignore = false;

    async function loadTelemetry() {
      try {
        const [overviewRes, workersRes, netRes] = await Promise.allSettled([
          getAdminOverview(),
          getAdminWorkers(),
          getRoutingNetworkSummary(),
        ]);

        if (ignore) return;

        if (overviewRes.status === "fulfilled") {
          setOverview(overviewRes.value);
        } else {
          setError(overviewRes.reason?.message || "Failed to load platform overview");
        }

        if (workersRes.status === "fulfilled" && workersRes.value?.workers) {
          setWorkers(workersRes.value.workers);
        } else {
          setWorkers([]);
        }

        if (netRes.status === "fulfilled") {
          setNetworkSummary(netRes.value);
        } else {
          setNetworkSummary(null);
        }

        setLastRefreshedAt(new Date());
      } catch (err) {
        if (!ignore) {
          setError(err.message || "Failed to connect to backend telemetry endpoints.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadTelemetry();

    return () => {
      ignore = true;
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const [overviewRes, workersRes, netRes] = await Promise.allSettled([
        getAdminOverview(),
        getAdminWorkers(),
        getRoutingNetworkSummary(),
      ]);

      if (overviewRes.status === "fulfilled") {
        setOverview(overviewRes.value);
      } else {
        setError(overviewRes.reason?.message || "Failed to load platform overview");
      }

      if (workersRes.status === "fulfilled" && workersRes.value?.workers) {
        setWorkers(workersRes.value.workers);
      } else {
        setWorkers([]);
      }

      if (netRes.status === "fulfilled") {
        setNetworkSummary(netRes.value);
      } else {
        setNetworkSummary(null);
      }

      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(err.message || "Failed to connect to backend telemetry endpoints.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                <LayoutDashboard size={20} />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Platform Overview
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Operational telemetry, ML model deployments, road network infrastructure, and real-time backend health.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {lastRefreshedAt && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock size={13} className="text-slate-400" />
                <span>Synced: {lastRefreshedAt.toLocaleTimeString()}</span>
              </span>
            )}

            <button
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw
                size={13}
                className={isRefreshing ? "animate-spin text-indigo-600" : "text-slate-500"}
              />
              <span>{isRefreshing ? "Refreshing..." : "Refresh Telemetry"}</span>
            </button>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
              <CheckCircle2 size={13} className="text-emerald-600" />
              <span>Backend API Ready</span>
            </span>
          </div>
        </div>
      </div>

      {/* Error Alert Banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Telemetry Fetch Error</p>
            <p className="text-sm mt-0.5 text-rose-800">{error}</p>
          </div>
          <button
            onClick={handleRefresh}
            className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoading && !overview && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-200/70 border border-slate-200" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 rounded-2xl bg-slate-200/70 border border-slate-200" />
            <div className="h-64 rounded-2xl bg-slate-200/70 border border-slate-200" />
          </div>
          <div className="h-64 rounded-2xl bg-slate-200/70 border border-slate-200" />
        </div>
      )}

      {/* Main Content */}
      {overview && (
        <>
          {/* Section A: Top-Level Platform Metrics */}
          <section aria-label="Platform Metrics">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Users */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Total Users
                  </span>
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-600 border border-blue-100">
                    <Users size={18} />
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-bold text-slate-900 tracking-tight">
                    {overview.total_users !== undefined && overview.total_users !== null
                      ? overview.total_users.toLocaleString()
                      : "Unavailable"}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    Registered accounts across all roles
                  </p>
                </div>
              </div>

              {/* Card 2: Active Users */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Active Users
                  </span>
                  <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 border border-emerald-100">
                    <UserCheck size={18} />
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-bold text-emerald-700 tracking-tight">
                    {overview.active_users !== undefined && overview.active_users !== null
                      ? overview.active_users.toLocaleString()
                      : "Unavailable"}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    Active accounts permitted to authenticate
                  </p>
                </div>
              </div>

              {/* Card 3: Inactive / Suspended */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Inactive Accounts
                  </span>
                  <div className="rounded-lg bg-amber-50 p-2 text-amber-600 border border-amber-100">
                    <UserX size={18} />
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-bold text-amber-700 tracking-tight">
                    {overview.inactive_users !== undefined && overview.inactive_users !== null
                      ? overview.inactive_users.toLocaleString()
                      : "Unavailable"}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    Deactivated or suspended user logins
                  </p>
                </div>
              </div>

              {/* Card 4: Active Administrators */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Active Admins
                  </span>
                  <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                    <ShieldCheck size={18} />
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-bold text-indigo-700 tracking-tight">
                    {overview.total_active_admins !== undefined && overview.total_active_admins !== null
                      ? overview.total_active_admins.toLocaleString()
                      : "Unavailable"}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    Privileged administrator accounts
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Section B & C: ML Deployment & Road Network Infrastructure */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Section B: ML Model Deployment Telemetry */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-purple-50 p-2 text-purple-600 border border-purple-100">
                      <Cpu size={18} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        ML Model Deployment
                      </h2>
                      <p className="text-xs text-slate-500">Traffic inference engine runtime</p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                      overview.model_deployment_status === "DEPLOYED"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        overview.model_deployment_status === "DEPLOYED" ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    <span>{overview.model_deployment_status === "DEPLOYED" ? "Active Deployed" : "No Active Model"}</span>
                  </span>
                </div>

                {overview.active_model ? (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500">Model ID</span>
                        <p className="mt-1 font-mono font-bold text-slate-900 truncate">
                          {overview.active_model.id}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500">Framework</span>
                        <p className="mt-1 font-mono font-bold text-slate-900 truncate">
                          {overview.active_model.model_framework_version || "Scikit-Learn"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500">Dataset Identity</span>
                        <p className="mt-1 font-semibold text-slate-800 truncate">
                          {overview.active_model.dataset_identity}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-[11px] font-semibold text-slate-500">Dataset Version</span>
                        <p className="mt-1 font-mono text-slate-800 truncate">
                          {overview.active_model.dataset_version}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs flex items-center justify-between">
                      <span className="text-slate-500">Deployed At:</span>
                      <span className="font-medium text-slate-800">
                        {formatTimestamp(overview.active_model.deployed_at)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-5 text-center">
                    <p className="text-xs font-semibold text-slate-600">No active model currently deployed</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Standard heuristic estimations and route travel time approximations are serving requests.
                    </p>
                    <div className="mt-3">
                      <Link
                        to="/admin/models"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                      >
                        <span>Inspect Model Registry</span>
                        <ArrowUpRight size={12} />
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Data Provenance Notice (Critical Invariant) */}
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900">
                <div className="flex items-start gap-2">
                  <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Dataset Provenance Notice:</span>
                    <p className="mt-0.5 leading-relaxed text-amber-800">
                      Experimental baseline model trained on the <span className="font-semibold underline">UCI Metro Interstate Traffic Volume dataset (Minnesota)</span>.
                      Not calibrated for local Chandigarh Tricity live vehicle sensors.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Section C: Road Network Status & Regional Coverage */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-teal-50 p-2 text-teal-600 border border-teal-100">
                      <Network size={18} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        Road Network Infrastructure
                      </h2>
                      <p className="text-xs text-slate-500">Static OpenStreetMap graph topology (No live sensor telemetry)</p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                      overview.road_network?.available || networkSummary?.available_locally
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        overview.road_network?.available || networkSummary?.available_locally
                          ? "bg-emerald-500"
                          : "bg-slate-400"
                      }`}
                    />
                    <span>
                      {overview.road_network?.available || networkSummary?.available_locally
                        ? "Graph In-Memory"
                        : "Network Offline"}
                    </span>
                  </span>
                </div>

                {/* Graph Metric Badges */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">OSM Nodes</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {networkSummary?.node_count !== undefined && networkSummary?.node_count !== null
                        ? networkSummary.node_count.toLocaleString()
                        : "Unavailable"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Directed Edges</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {networkSummary?.directed_edge_count !== undefined && networkSummary?.directed_edge_count !== null
                        ? networkSummary.directed_edge_count.toLocaleString()
                        : overview.road_network?.edges_count !== null && overview.road_network?.edges_count !== undefined
                        ? overview.road_network.edges_count.toLocaleString()
                        : "Unavailable"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Topol. Intersections</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {networkSummary?.intersection_count !== undefined && networkSummary?.intersection_count !== null
                        ? networkSummary.intersection_count.toLocaleString()
                        : overview.road_network?.intersections_count !== null && overview.road_network?.intersections_count !== undefined
                        ? overview.road_network.intersections_count.toLocaleString()
                        : "Unavailable"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Mapped Signals</span>
                    <p className="mt-1 text-base font-bold text-slate-900">
                      {networkSummary?.mapped_traffic_signal_count !== undefined && networkSummary?.mapped_traffic_signal_count !== null
                        ? networkSummary.mapped_traffic_signal_count.toLocaleString()
                        : "Unavailable"}
                    </p>
                  </div>
                </div>

                {/* Target Coverage Areas */}
                <div className="mt-3.5">
                  <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    <span>Configured Regional Boundary Targets (Static Geographic Audit)</span>
                  </span>
                  {networkSummary?.target_area_coverage?.areas ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.values(networkSummary.target_area_coverage.areas).map((area) => {
                        const areaName = typeof area === "object" && area !== null ? area.name || area.description : area;
                        return (
                          <span
                            key={areaName}
                            className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 border border-slate-200"
                          >
                            {areaName}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">Coverage target metadata unavailable</p>
                  )}
                </div>
              </div>

              {/* Road Network Invariant Notice (Critical Invariant) */}
              <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50/80 p-3.5 text-xs text-sky-950">
                <div className="flex items-start gap-2">
                  <Info size={15} className="text-sky-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Road Network Graph Invariant:</span>
                    <p className="mt-0.5 leading-relaxed text-sky-800">
                      OSM geographic routing graph. 45,148 topological nodes; 26 mapped signal tags in OSM (not a physical signal census).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section D: System & Background Worker Health */}
          <section aria-label="System and Worker Status">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 border border-emerald-100">
                    <Activity size={18} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      System & Worker Health
                    </h2>
                    <p className="text-xs text-slate-500">Core FastAPI service and background worker pool</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-mono font-medium text-slate-700 border border-slate-200">
                    <Server size={12} className="text-slate-500" />
                    <span>{overview.backend_health?.service || "ITMS Backend"} v{overview.backend_health?.version || "1.0.0"}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Service: {overview.backend_health?.status || "healthy"}</span>
                  </span>
                </div>
              </div>

              {/* Workers Table or Empty State */}
              <div className="mt-4">
                {workers.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-4 py-3">Worker ID</th>
                          <th className="px-4 py-3">Process ID (PID)</th>
                          <th className="px-4 py-3">Loaded Model</th>
                          <th className="px-4 py-3">Last Heartbeat</th>
                          <th className="px-4 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-normal text-slate-700">
                        {workers.map((worker) => (
                          <tr key={worker.worker_id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                              {worker.worker_id}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-600">
                              {worker.pid}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-600">
                              {worker.loaded_model_id || `v${worker.loaded_version}`}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {formatTimestamp(worker.last_heartbeat)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {worker.is_stale ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                                  <AlertTriangle size={11} className="text-amber-500" />
                                  <span>Stale Heartbeat</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  <span>{worker.status || "Active"}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                    <Server size={24} className="mx-auto text-slate-400" />
                    <p className="mt-2 text-xs font-semibold text-slate-700">
                      No worker records available
                    </p>
                    <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                      Background worker processes have not registered active records in the worker deployment table. Scheduled pipelines execute asynchronously.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section E: Recent Administrative Activity */}
          <section aria-label="Recent Administrative Activity">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                    <Shield size={18} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Recent Administrative Activity
                    </h2>
                    <p className="text-xs text-slate-500">Latest security and audit trail log events</p>
                  </div>
                </div>

                <Link
                  to="/admin/audit-logs"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  <span>View Full Audit Logs</span>
                  <ArrowUpRight size={13} />
                </Link>
              </div>

              <div className="mt-4">
                {overview.recent_audit_activity && overview.recent_audit_activity.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-4 py-3">Action</th>
                          <th className="px-4 py-3">Actor</th>
                          <th className="px-4 py-3">Target</th>
                          <th className="px-4 py-3">Details</th>
                          <th className="px-4 py-3 text-right">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-normal text-slate-700">
                        {overview.recent_audit_activity.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3 font-mono font-medium">
                              <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-100">
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-800">
                              {log.actor_email || log.actor_name || log.actor_id || "System"}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-600">
                              {log.target_entity}
                            </td>
                            <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={log.details}>
                              {log.details}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">
                              {formatTimestamp(log.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                    <Layers size={24} className="mx-auto text-slate-400" />
                    <p className="mt-2 text-xs font-semibold text-slate-700">
                      No administrative activity recorded
                    </p>
                    <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                      Administrative mutations such as role updates, status changes, and model deployments are logged immutably.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
