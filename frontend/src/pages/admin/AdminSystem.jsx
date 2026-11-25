import { useState, useEffect, useRef, useCallback } from "react";
import {
  Server,
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Network,
  Globe,
  Info,
  Pause,
  Play,
} from "lucide-react";
import {
  getAdminWorkers,
  getHealthStatus,
  getRoutingNetworkStatus,
  getRoutingProviderStatus,
} from "../../services/api";
import {
  POLL_INTERVAL_MS,
  formatSystemTimestamp,
  classifyHealthStatus,
  classifyWorkersStatus,
  classifyNetworkStatus,
  classifyProviderStatus,
} from "../../utils/systemStatusUtils";

const TONE_BADGE_CLASSES = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  danger: "bg-rose-50 text-rose-700 border-rose-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

const WORKER_STATUS_CLASSES = {
  READY: "bg-emerald-50 text-emerald-700 border-emerald-200",
  LOAD_FAILED: "bg-rose-50 text-rose-700 border-rose-200",
  CHECKSUM_MISMATCH: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function AdminSystem() {
  const [healthState, setHealthState] = useState({ loading: true, data: null, error: null });
  const [workersState, setWorkersState] = useState({ loading: true, data: null, error: null });
  const [networkState, setNetworkState] = useState({ loading: true, data: null, error: null });
  const [providerState, setProviderState] = useState({ loading: true, data: null, error: null });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const latestCycleRef = useRef(0);
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  const runStatusCycle = useCallback(async ({ manual = false } = {}) => {
    if (inFlightRef.current && !manual) return;
    inFlightRef.current = true;
    const cycleId = ++latestCycleRef.current;

    if (manual) {
      setIsRefreshing(true);
    }

    const [healthRes, workersRes, networkRes, providerRes] = await Promise.allSettled([
      getHealthStatus(),
      getAdminWorkers(),
      getRoutingNetworkStatus(),
      getRoutingProviderStatus(),
    ]);

    if (!isMountedRef.current || cycleId !== latestCycleRef.current) {
      inFlightRef.current = false;
      return;
    }

    setHealthState(
      healthRes.status === "fulfilled"
        ? { loading: false, data: healthRes.value, error: null }
        : { loading: false, data: null, error: healthRes.reason?.message || "Backend health endpoint unavailable." }
    );

    setWorkersState(
      workersRes.status === "fulfilled"
        ? { loading: false, data: workersRes.value, error: null }
        : { loading: false, data: null, error: workersRes.reason?.message || "Worker status endpoint unavailable." }
    );

    setNetworkState(
      networkRes.status === "fulfilled"
        ? { loading: false, data: networkRes.value, error: null }
        : { loading: false, data: null, error: networkRes.reason?.message || "Road-network graph unavailable." }
    );

    setProviderState(
      providerRes.status === "fulfilled"
        ? { loading: false, data: providerRes.value, error: null }
        : { loading: false, data: null, error: providerRes.reason?.message || "Provider configuration unavailable." }
    );

    const anySucceeded = [healthRes, workersRes, networkRes, providerRes].some(
      (r) => r.status === "fulfilled"
    );
    if (anySucceeded) {
      setLastSyncedAt(new Date());
    }

    setIsRefreshing(false);
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    // Schedule initial load asynchronously outside synchronous effect body
    const initTimer = setTimeout(() => {
      runStatusCycle({ manual: false });
    }, 0);

    return () => {
      isMountedRef.current = false;
      clearTimeout(initTimer);
    };
  }, [runStatusCycle]);

  useEffect(() => {
    if (!autoRefreshEnabled) return undefined;
    const intervalId = setInterval(() => {
      runStatusCycle({ manual: false });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [autoRefreshEnabled, runStatusCycle]);

  const healthSummary = classifyHealthStatus(healthState);
  const workersSummary = classifyWorkersStatus(workersState);
  const networkSummary = classifyNetworkStatus(networkState);
  const providerSummary = classifyProviderStatus(providerState);

  const workers = Array.isArray(workersState.data?.workers) ? workersState.data.workers : [];
  const boundary = providerState.data?.regional_boundary;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                <Server size={20} />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                System & Worker Status
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Read-only operational status for backend liveness, worker heartbeats, local OSM graph files, and routing configuration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {lastSyncedAt && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Clock size={13} className="text-slate-400" />
                <span>Synced: {lastSyncedAt.toLocaleTimeString()}</span>
              </span>
            )}

            <button
              type="button"
              onClick={() => setAutoRefreshEnabled((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
              aria-label={autoRefreshEnabled ? "Pause 30s auto-refresh" : "Resume 30s auto-refresh"}
            >
              {autoRefreshEnabled ? (
                <>
                  <Pause size={12} className="text-slate-500" />
                  <span>Auto-Refresh: 30s</span>
                </>
              ) : (
                <>
                  <Play size={12} className="text-indigo-600" />
                  <span>Auto-Refresh: Paused</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => runStatusCycle({ manual: true })}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw
                size={13}
                className={isRefreshing ? "animate-spin text-indigo-600" : "text-slate-500"}
              />
              <span>{isRefreshing ? "Refreshing..." : "Refresh Status"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section A: Platform Health Overview Cards */}
      <section aria-label="Platform Status Overview">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Backend Liveness */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Backend Liveness
              </span>
              <Activity size={17} className="text-slate-400" />
            </div>
            <div className="mt-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  TONE_BADGE_CLASSES[healthSummary.tone]
                }`}
              >
                {healthSummary.label}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {healthState.error
                  ? "Backend health endpoint unavailable."
                  : healthState.data
                  ? `API v${healthState.data.version || "—"} HTTP process responding`
                  : "Querying /health..."}
              </p>
            </div>
          </div>

          {/* Card 2: Worker Deployment */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Worker Deployment
              </span>
              <Cpu size={17} className="text-slate-400" />
            </div>
            <div className="mt-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  TONE_BADGE_CLASSES[workersSummary.tone]
                }`}
              >
                {workersSummary.label}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {workersState.error
                  ? "Worker status endpoint unavailable."
                  : workersState.data
                  ? `${workersState.data.total ?? workers.length} registered worker record(s)`
                  : "Querying worker registry..."}
              </p>
            </div>
          </div>

          {/* Card 3: Road-Network Graph */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Road-Network Graph
              </span>
              <Network size={17} className="text-slate-400" />
            </div>
            <div className="mt-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  TONE_BADGE_CLASSES[networkSummary.tone]
                }`}
              >
                {networkSummary.label}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {networkState.error
                  ? "Road-network graph unavailable."
                  : networkState.data
                  ? `Static OSM GraphML (${networkState.data.file_size_mb ?? "—"} MB)`
                  : "Checking local graph..."}
              </p>
            </div>
          </div>

          {/* Card 4: Routing Provider Configuration */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Routing Providers
              </span>
              <Globe size={17} className="text-slate-400" />
            </div>
            <div className="mt-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  TONE_BADGE_CLASSES[providerSummary.tone]
                }`}
              >
                {providerSummary.label}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {providerState.error
                  ? "Provider configuration unavailable."
                  : providerState.data
                  ? `${providerState.data.routing_provider || "—"} & ${providerState.data.geocoding_provider || "—"} configured`
                  : "Checking provider config..."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section B: Worker Deployment & Heartbeat Telemetry */}
      <section aria-label="Worker Deployment Monitoring" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
              <Cpu size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Worker Deployment Status</h2>
              <p className="text-xs text-slate-500">
                Persisted worker process records and backend-computed heartbeat staleness (&gt; 60s)
              </p>
            </div>
          </div>
          {workersState.data && (
            <span className="text-xs font-mono text-slate-500">
              Total Workers: {workersState.data.total ?? workers.length}
            </span>
          )}
        </div>

        <div className="mt-4">
          {workersState.loading && !workersState.data && !workersState.error && (
            <div className="space-y-3 animate-pulse">
              <div className="h-12 rounded-xl bg-slate-100" />
              <div className="h-12 rounded-xl bg-slate-100" />
            </div>
          )}

          {workersState.error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2.5">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>Worker status endpoint unavailable: {workersState.error}</span>
            </div>
          )}

          {!workersState.loading && !workersState.error && workers.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
              <Server size={24} className="mx-auto text-slate-400" />
              <p className="mt-2 text-xs font-bold text-slate-700">
                No worker deployment records registered.
              </p>
              <p className="mt-1 text-xs text-slate-500 max-w-lg mx-auto">
                No background worker processes have emitted heartbeats to <code className="font-mono text-[11px]">worker_deployment_status</code>. Zero registered workers does not indicate that the FastAPI web application is offline.
              </p>
            </div>
          )}

          {!workersState.error && workers.length > 0 && (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Worker ID</th>
                      <th className="px-4 py-3">PID</th>
                      <th className="px-4 py-3">Loaded Model</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Heartbeat</th>
                      <th className="px-4 py-3">Liveness</th>
                      <th className="px-4 py-3">Error Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {workers.map((w) => (
                      <tr key={w.worker_id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                          {w.worker_id}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600">
                          {w.pid ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          <div>{w.loaded_model_id || "—"}</div>
                          <div className="text-[10px] text-slate-400">v{w.loaded_version ?? "—"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                              WORKER_STATUS_CLASSES[w.status] || "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {w.status || "UNKNOWN"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                          {formatSystemTimestamp(w.last_heartbeat)}
                        </td>
                        <td className="px-4 py-3">
                          {w.is_stale ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                              <AlertTriangle size={11} className="text-amber-600" />
                              <span>Stale (&gt;60s)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={11} className="text-emerald-600" />
                              <span>Fresh</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-rose-700 font-mono text-[11px] max-w-xs break-all">
                          {w.error_message || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Worker Cards */}
              <div className="lg:hidden space-y-3">
                {workers.map((w) => (
                  <div key={w.worker_id} className="rounded-xl border border-slate-200 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-900">{w.worker_id}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                          WORKER_STATUS_CLASSES[w.status] || "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {w.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <div>PID: <span className="font-mono">{w.pid ?? "—"}</span></div>
                      <div>Version: <span className="font-mono">v{w.loaded_version ?? "—"}</span></div>
                      <div className="col-span-2 truncate">Model: <span className="font-mono">{w.loaded_model_id || "—"}</span></div>
                      <div className="col-span-2">Heartbeat: {formatSystemTimestamp(w.last_heartbeat)}</div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      {w.is_stale ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                          Stale (&gt;60s)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                          Fresh
                        </span>
                      )}
                    </div>
                    {w.error_message && (
                      <p className="rounded-lg bg-rose-50 p-2 font-mono text-[11px] text-rose-700 border border-rose-200 break-all">
                        {w.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Section C, D, E: Backend Liveness, Road-Network File Status & Provider Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* C. Backend Liveness */}
        <section aria-label="Backend Liveness Details" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Activity size={18} className="text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-900">Backend Liveness</h2>
            </div>

            {healthState.error ? (
              <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                Backend health endpoint unavailable: {healthState.error}
              </div>
            ) : healthState.data ? (
              <dl className="mt-4 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Status:</dt>
                  <dd className="font-mono font-bold text-emerald-700">{healthState.data.status}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Service:</dt>
                  <dd className="font-medium text-slate-800 text-right">{healthState.data.service || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Version:</dt>
                  <dd className="font-mono text-slate-800">{healthState.data.version || "—"}</dd>
                </div>
              </dl>
            ) : (
              <div className="mt-4 h-20 rounded-xl bg-slate-100 animate-pulse" />
            )}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 flex items-start gap-2">
            <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
            <span>Static HTTP liveness check only. Does not establish database readiness, ML readiness, or worker availability.</span>
          </div>
        </section>

        {/* D. Road-Network Graph Status */}
        <section aria-label="Road-Network Status Details" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Network size={18} className="text-teal-600" />
              <h2 className="text-sm font-bold text-slate-900">Road-Network Graph Status</h2>
            </div>

            {networkState.error ? (
              <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                Road-network graph unavailable: {networkState.error}
              </div>
            ) : networkState.data ? (
              <dl className="mt-4 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Graph Status:</dt>
                  <dd className="font-mono font-bold text-slate-900">{networkState.data.status || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Available Locally:</dt>
                  <dd className="font-mono text-slate-800">{String(Boolean(networkState.data.available_locally))}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Artifact Size:</dt>
                  <dd className="font-mono text-slate-800">
                    {networkState.data.file_size_mb !== undefined && networkState.data.file_size_mb !== null
                      ? `${networkState.data.file_size_mb} MB`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Region:</dt>
                  <dd className="font-medium text-slate-800 text-right">
                    {networkState.data.metadata?.region_name || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Extracted (UTC):</dt>
                  <dd className="text-slate-700 text-right">
                    {formatSystemTimestamp(networkState.data.metadata?.extraction_date_utc)}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="mt-4 h-24 rounded-xl bg-slate-100 animate-pulse" />
            )}
          </div>

          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-[11px] text-sky-900 flex items-start gap-2">
            <Info size={14} className="text-sky-600 shrink-0 mt-0.5" />
            <span>Static OpenStreetMap GraphML topology file status. Does not represent live vehicle or sensor telemetry.</span>
          </div>
        </section>

        {/* E. Routing-Provider Configuration */}
        <section aria-label="Routing-Provider Configuration" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Globe size={18} className="text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900">Routing-Provider Status</h2>
            </div>

            {providerState.error ? (
              <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                Provider configuration unavailable: {providerState.error}
              </div>
            ) : providerState.data ? (
              <dl className="mt-4 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Config State:</dt>
                  <dd className="font-mono font-bold text-sky-700">{providerState.data.provider_status || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Routing:</dt>
                  <dd className="font-mono text-slate-800 text-right break-all">
                    {providerState.data.routing_provider || "—"} ({providerState.data.routing_base_url || "—"})
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Geocoding:</dt>
                  <dd className="font-mono text-slate-800 text-right break-all">
                    {providerState.data.geocoding_provider || "—"} ({providerState.data.geocoding_base_url || "—"})
                  </dd>
                </div>
                {boundary && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Bounding Box:</dt>
                    <dd className="font-mono text-[11px] text-slate-700 text-right">
                      [{boundary.west}, {boundary.south}, {boundary.east}, {boundary.north}]
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <div className="mt-4 h-24 rounded-xl bg-slate-100 animate-pulse" />
            )}
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-900 flex items-start gap-2">
            <Info size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <span>Reports static provider configuration only. No external network requests are made to probe live OSRM or Nominatim reachability.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
