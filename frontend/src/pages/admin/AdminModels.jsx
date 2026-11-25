import { useState, useEffect, useRef, useCallback } from "react";
import {
  BrainCircuit,
  RefreshCw,
  AlertTriangle,
  Info,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Layers,
  Clock,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import { getAdminModels, getAdminTrainingJobs } from "../../services/api";
import {
  TRAINING_JOB_STATUSES,
  safeJsonParse,
  formatModelMetricValue,
  formatModelTimestamp,
  calculateJobDuration,
  summarizeModelRegistry,
  computeJobsPagination,
} from "../../utils/modelMonitoringUtils";

const JOBS_PAGE_LIMIT = 20;

const REVIEW_BADGE_CLASSES = {
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PENDING_REVIEW: "bg-amber-50 text-amber-800 border-amber-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
};

const JOB_STATUS_CLASSES = {
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  RUNNING: "bg-sky-50 text-sky-700 border-sky-200",
  QUEUED: "bg-slate-100 text-slate-700 border-slate-200",
  FAILED: "bg-rose-50 text-rose-700 border-rose-200",
  CANCELLED: "bg-amber-50 text-amber-800 border-amber-200",
};

function SafeJsonBlock({ rawValue, emptyLabel = "None recorded" }) {
  const parsed = safeJsonParse(rawValue);
  if (parsed.isEmpty) {
    return <span className="text-xs text-slate-400">{emptyLabel}</span>;
  }
  if (!parsed.ok) {
    return (
      <div className="space-y-1">
        <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
          Malformed JSON
        </span>
        <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700 border border-slate-200">
          {parsed.raw}
        </pre>
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700 border border-slate-200 max-h-48 overflow-y-auto">
      {parsed.formatted}
    </pre>
  );
}

export default function AdminModels() {
  // Independent state for Model Registry
  const [registryState, setRegistryState] = useState({
    loading: true,
    data: null,
    error: null,
  });

  // Independent state for Training Jobs
  const [jobsState, setJobsState] = useState({
    loading: true,
    data: null,
    error: null,
  });

  const [statusFilter, setStatusFilter] = useState("all");
  const [jobsOffset, setJobsOffset] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Detail modals
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);

  // Monotonic request IDs for stale-response protection
  const registryReqIdRef = useRef(0);
  const jobsReqIdRef = useRef(0);

  const fetchRegistry = useCallback(async () => {
    const reqId = ++registryReqIdRef.current;
    try {
      const data = await getAdminModels();
      if (reqId !== registryReqIdRef.current) return;
      setRegistryState({ loading: false, data, error: null });
    } catch (err) {
      if (reqId !== registryReqIdRef.current) return;
      setRegistryState({
        loading: false,
        data: null,
        error: err.message || "Failed to load model registry.",
      });
    }
  }, []);

  const fetchJobs = useCallback(async (statusToUse, offsetToUse) => {
    const reqId = ++jobsReqIdRef.current;
    try {
      const data = await getAdminTrainingJobs({
        status: statusToUse,
        limit: JOBS_PAGE_LIMIT,
        offset: offsetToUse,
      });
      if (reqId !== jobsReqIdRef.current) return;
      setJobsState({ loading: false, data, error: null });
    } catch (err) {
      if (reqId !== jobsReqIdRef.current) return;
      setJobsState({
        loading: false,
        data: null,
        error: err.message || "Failed to load training jobs.",
      });
    }
  }, []);

  // Initial load for registry
  useEffect(() => {
    let ignore = false;
    const reqId = ++registryReqIdRef.current;
    async function initRegistry() {
      try {
        const data = await getAdminModels();
        if (!ignore && reqId === registryReqIdRef.current) {
          setRegistryState({ loading: false, data, error: null });
        }
      } catch (err) {
        if (!ignore && reqId === registryReqIdRef.current) {
          setRegistryState({
            loading: false,
            data: null,
            error: err.message || "Failed to load model registry.",
          });
        }
      }
    }
    initRegistry();
    return () => {
      ignore = true;
    };
  }, []);

  // Load jobs whenever statusFilter or jobsOffset changes
  useEffect(() => {
    let ignore = false;
    const reqId = ++jobsReqIdRef.current;
    async function loadJobs() {
      try {
        const data = await getAdminTrainingJobs({
          status: statusFilter,
          limit: JOBS_PAGE_LIMIT,
          offset: jobsOffset,
        });
        if (!ignore && reqId === jobsReqIdRef.current) {
          setJobsState({ loading: false, data, error: null });
        }
      } catch (err) {
        if (!ignore && reqId === jobsReqIdRef.current) {
          setJobsState({
            loading: false,
            data: null,
            error: err.message || "Failed to load training jobs.",
          });
        }
      }
    }
    loadJobs();
    return () => {
      ignore = true;
    };
  }, [statusFilter, jobsOffset]);

  const handleRefreshAll = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await Promise.allSettled([fetchRegistry(), fetchJobs(statusFilter, jobsOffset)]);
    setIsRefreshing(false);
  };

  const handleStatusFilterChange = (newStatus) => {
    setJobsState((prev) => ({ ...prev, loading: true, error: null }));
    setJobsOffset(0);
    setStatusFilter(newStatus);
  };

  const models = Array.isArray(registryState.data?.models) ? registryState.data.models : [];
  const registrySummary = summarizeModelRegistry(
    registryState.data ? models : null
  );

  const jobs = Array.isArray(jobsState.data?.jobs) ? jobsState.data.jobs : [];
  const jobsTotal = jobsState.data?.total;
  const pagination = computeJobsPagination(
    jobsTotal ?? 0,
    jobsState.data?.limit ?? JOBS_PAGE_LIMIT,
    jobsOffset,
    jobs.length
  );

  // Job status counts on the current page
  const pageStatusCounts = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                <BrainCircuit size={20} />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                ML Model Governance
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Read-only oversight of the reproducible model registry, training job lifecycle, evaluation metrics, and provenance metadata.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs cursor-pointer self-start md:self-auto"
          >
            <RefreshCw
              size={13}
              className={isRefreshing ? "animate-spin text-indigo-600" : "text-slate-500"}
            />
            <span>{isRefreshing ? "Refreshing..." : "Refresh Data"}</span>
          </button>
        </div>
      </div>

      {/* Critical Architectural & Dataset Provenance Disclosures */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950 flex items-start gap-2.5">
          <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Runtime Serving & Registry Separation</p>
            <p className="mt-1 leading-relaxed text-amber-900">
              The prediction service currently loads the static offline artifact (<code className="font-mono text-[11px]">backend/models/traffic_model.pkl</code>) directly and does not select models from <code className="font-mono text-[11px]">active_model_deployment</code>. Registry and job records here do not indicate runtime model adoption, and no in-app train/review/deploy/rollback endpoints exist.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-xs text-sky-950 flex items-start gap-2.5">
          <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Dataset Provenance Notice</p>
            <p className="mt-1 leading-relaxed text-sky-900">
              The offline baseline <code className="font-mono text-[11px]">RandomForestClassifier</code> was trained on the <span className="font-semibold underline">Minnesota UCI Metro Interstate Traffic Volume</span> dataset. It is not calibrated for Chandigarh Tricity live sensor traffic.
            </p>
          </div>
        </div>
      </div>

      {/* Section A: Model Registry Overview */}
      <section aria-label="Model Registry Overview">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Registered Models
            </span>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {registryState.error
                ? "Unavailable"
                : registrySummary.total !== null
                ? registrySummary.total.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Cataloged model artifacts</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Registry Models
            </span>
            <p className="mt-2 text-2xl font-bold text-indigo-700">
              {registryState.error
                ? "Unavailable"
                : registrySummary.activeCount !== null
                ? registrySummary.activeCount.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-xs font-mono text-slate-500 truncate">
              Pointer: {registryState.data?.active_model_id || "None"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pending Review
            </span>
            <p className="mt-2 text-2xl font-bold text-amber-700">
              {registryState.error
                ? "Unavailable"
                : registrySummary.pendingReviewCount !== null
                ? registrySummary.pendingReviewCount.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Awaiting governance review</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Review Breakdown
            </span>
            <div className="mt-2 text-sm font-semibold text-slate-800">
              {registryState.error ? (
                <span className="text-slate-500">Unavailable</span>
              ) : registryState.data ? (
                <div className="flex items-center gap-3">
                  <span className="text-emerald-700">Approved: {registrySummary.approvedCount}</span>
                  <span className="text-rose-700">Rejected: {registrySummary.rejectedCount}</span>
                </div>
              ) : (
                "—"
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">Governance review statuses</p>
          </div>
        </div>
      </section>

      {/* Section B: Registered Models Table */}
      <section aria-label="Registered Models Catalog" className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Registered Models</h2>
          </div>
          {registryState.data && (
            <span className="text-xs font-mono text-slate-500">
              Total: {registryState.data.total}
            </span>
          )}
        </div>

        {registryState.error && (
          <div role="alert" className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{registryState.error}</span>
            </div>
            <button
              type="button"
              onClick={fetchRegistry}
              className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {registryState.loading && !registryState.data && !registryState.error && (
          <div className="p-5 space-y-3 animate-pulse">
            <div className="h-12 rounded-xl bg-slate-100" />
            <div className="h-12 rounded-xl bg-slate-100" />
          </div>
        )}

        {!registryState.loading && !registryState.error && models.length === 0 && (
          <div className="p-8 text-center">
            <GitBranch size={26} className="mx-auto text-slate-400" />
            <p className="mt-2 text-sm font-bold text-slate-800">
              No registered models in catalog
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              The <code className="font-mono text-[11px]">model_registry</code> and <code className="font-mono text-[11px]">active_model_deployment</code> tables are empty. The offline pickle model is not represented as a registered deployment.
            </p>
          </div>
        )}

        {!registryState.error && models.length > 0 && (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3.5">Model ID</th>
                    <th className="px-4 py-3.5">Dataset</th>
                    <th className="px-4 py-3.5">Framework</th>
                    <th className="px-4 py-3.5">Review Status</th>
                    <th className="px-4 py-3.5">Registry State</th>
                    <th className="px-4 py-3.5">Trained At</th>
                    <th className="px-4 py-3.5">Deployed At</th>
                    <th className="px-5 py-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {models.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3.5 font-mono font-semibold text-slate-900">
                        {m.id}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-800">{m.dataset_identity}</div>
                        <div className="text-[11px] font-mono text-slate-500">v{m.dataset_version}</div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-700">
                        {m.model_framework_version || "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                            REVIEW_BADGE_CLASSES[m.review_status] || "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {m.review_status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {m.is_active === 1 ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
                            Active Pointer
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-500">
                        {formatModelTimestamp(m.trained_at)}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-500">
                        {formatModelTimestamp(m.deployed_at)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedModel(m)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                        >
                          <Eye size={12} />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Model Cards */}
            <div className="lg:hidden divide-y divide-slate-100">
              {models.map((m) => (
                <div key={m.id} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono font-bold text-slate-900 break-all">{m.id}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0 ${
                        REVIEW_BADGE_CLASSES[m.review_status] || "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {m.review_status}
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Dataset: {m.dataset_identity} (<span className="font-mono">v{m.dataset_version}</span>)
                  </div>
                  <div className="text-slate-500">
                    Framework: <span className="font-mono">{m.model_framework_version || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500">
                      Trained: {formatModelTimestamp(m.trained_at)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedModel(m)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                    >
                      <Eye size={12} />
                      <span>Inspect</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Section C: Training Job Monitoring */}
      <section aria-label="Training Job Monitoring" className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-indigo-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">Training Jobs</h2>
              <p className="text-xs text-slate-500">
                Total matching jobs: {jobsState.error ? "Unavailable" : jobsTotal ?? "—"}
                {Object.keys(pageStatusCounts).length > 0 && (
                  <span className="ml-2 text-slate-400">
                    (Page: {Object.entries(pageStatusCounts).map(([k, v]) => `${k}: ${v}`).join(", ")})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="job-status-filter" className="text-xs font-semibold text-slate-600">
              Status:
            </label>
            <select
              id="job-status-filter"
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              {TRAINING_JOB_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        {jobsState.error && (
          <div role="alert" className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{jobsState.error}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchJobs(statusFilter, jobsOffset)}
              className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {jobsState.loading && !jobsState.data && !jobsState.error && (
          <div className="p-5 space-y-3 animate-pulse">
            <div className="h-12 rounded-xl bg-slate-100" />
            <div className="h-12 rounded-xl bg-slate-100" />
          </div>
        )}

        {!jobsState.loading && !jobsState.error && jobs.length === 0 && (
          <div className="p-8 text-center">
            <Layers size={26} className="mx-auto text-slate-400" />
            <p className="mt-2 text-sm font-bold text-slate-800">
              No training jobs found
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {statusFilter !== "all"
                ? `No training jobs with status '${statusFilter}'.`
                : "No ML training jobs have been recorded."}
            </p>
          </div>
        )}

        {!jobsState.error && jobs.length > 0 && (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3.5">Job ID</th>
                    <th className="px-4 py-3.5">Dataset</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Triggered By</th>
                    <th className="px-4 py-3.5">Created</th>
                    <th className="px-4 py-3.5">Duration</th>
                    <th className="px-4 py-3.5">Metrics / Error</th>
                    <th className="px-5 py-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {jobs.map((j) => {
                    const parsedMetrics = safeJsonParse(j.metrics);
                    return (
                      <tr key={j.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3.5 font-mono font-semibold text-slate-900">
                          {j.id}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="font-medium text-slate-800">{j.dataset_name}</span>
                          <span className="ml-1 font-mono text-[11px] text-slate-500">v{j.dataset_version}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                              JOB_STATUS_CLASSES[j.status] || "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {j.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600">
                          {j.triggered_by || "—"}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-slate-500">
                          {formatModelTimestamp(j.created_at)}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-slate-600 whitespace-nowrap">
                          {calculateJobDuration(j.started_at, j.completed_at)}
                        </td>
                        <td className="px-4 py-3.5 max-w-[200px] truncate">
                          {j.error_message ? (
                            <span className="text-rose-700 font-mono text-[11px]">{j.error_message}</span>
                          ) : parsedMetrics.isEmpty ? (
                            <span className="text-slate-400">—</span>
                          ) : !parsedMetrics.ok ? (
                            <span className="text-amber-700 text-[11px]">Malformed JSON</span>
                          ) : (
                            <span className="font-mono text-[11px] text-slate-700">
                              {JSON.stringify(parsedMetrics.value)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedJob(j)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                          >
                            <Eye size={12} />
                            <span>Details</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Job Cards */}
            <div className="lg:hidden divide-y divide-slate-100">
              {jobs.map((j) => (
                <div key={j.id} className="p-4 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono font-bold text-slate-900 break-all">{j.id}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0 ${
                        JOB_STATUS_CLASSES[j.status] || "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {j.status}
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Dataset: {j.dataset_name} (<span className="font-mono">v{j.dataset_version}</span>)
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      <span>{formatModelTimestamp(j.created_at)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedJob(j)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                    >
                      <Eye size={12} />
                      <span>Details</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Server-Side Pagination Footer */}
            <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Showing <span className="font-semibold text-slate-900">{pagination.startRow}</span>–
                <span className="font-semibold text-slate-900">{pagination.endRow}</span> of{" "}
                <span className="font-semibold text-slate-900">{jobsTotal ?? 0}</span> jobs
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setJobsState((prev) => ({ ...prev, loading: true }));
                    setJobsOffset(Math.max(0, jobsOffset - JOBS_PAGE_LIMIT));
                  }}
                  disabled={!pagination.canPrev || jobsState.loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>
                <span className="px-2 font-medium text-slate-700">
                  Page {pagination.currentPage} of {pagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setJobsState((prev) => ({ ...prev, loading: true }));
                    setJobsOffset(jobsOffset + JOBS_PAGE_LIMIT);
                  }}
                  disabled={!pagination.canNext || jobsState.loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Model Details Modal */}
      {selectedModel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="model-details-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 id="model-details-title" className="text-base font-bold text-slate-900">
                Registered Model Details
              </h2>
              <button
                type="button"
                onClick={() => setSelectedModel(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 cursor-pointer"
                aria-label="Close model details"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Model ID</span>
                  <p className="mt-0.5 font-mono font-bold text-slate-900 break-all">{selectedModel.id}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Feature Schema Version</span>
                  <p className="mt-0.5 font-mono font-semibold text-slate-800">
                    {selectedModel.feature_schema_version || "—"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Random Seed</span>
                  <p className="mt-0.5 font-mono text-slate-800">{formatModelMetricValue(selectedModel.random_seed)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Artifact Integrity</span>
                  <p className="mt-0.5 font-mono text-slate-800 break-all">
                    {selectedModel.artifact_checksum_sha256 ? `SHA256: ${selectedModel.artifact_checksum_sha256}` : "Unavailable"}
                  </p>
                </div>
              </div>

              <div>
                <span className="block font-semibold text-slate-700 mb-1">Feature Names</span>
                <SafeJsonBlock rawValue={selectedModel.feature_names} />
              </div>

              <div>
                <span className="block font-semibold text-slate-700 mb-1">Evaluation Metrics</span>
                <SafeJsonBlock rawValue={selectedModel.evaluation_metrics} emptyLabel="No metrics recorded" />
              </div>

              <div>
                <span className="block font-semibold text-slate-700 mb-1">Training Configuration</span>
                <SafeJsonBlock rawValue={selectedModel.training_config} />
              </div>

              <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Trained By / At:</span>
                  <span className="font-mono text-slate-800">
                    {selectedModel.trained_by || "—"} • {formatModelTimestamp(selectedModel.trained_at)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Reviewed By / At:</span>
                  <span className="font-mono text-slate-800">
                    {selectedModel.reviewed_by || "—"} • {formatModelTimestamp(selectedModel.reviewed_at)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Deployed By / At:</span>
                  <span className="font-mono text-slate-800">
                    {selectedModel.deployed_by || "—"} • {formatModelTimestamp(selectedModel.deployed_at)}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedModel(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Training Job Details Modal */}
      {selectedJob && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-details-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 id="job-details-title" className="text-base font-bold text-slate-900">
                Training Job Details
              </h2>
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 cursor-pointer"
                aria-label="Close job details"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Job ID</span>
                  <p className="mt-0.5 font-mono font-bold text-slate-900 break-all">{selectedJob.id}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Status</span>
                  <p className="mt-0.5 font-semibold text-slate-900">{selectedJob.status}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Dataset</span>
                  <p className="mt-0.5 font-medium text-slate-800">
                    {selectedJob.dataset_name} (v{selectedJob.dataset_version})
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Triggered By / Seed</span>
                  <p className="mt-0.5 font-mono text-slate-800">
                    {selectedJob.triggered_by || "—"} • seed {formatModelMetricValue(selectedJob.random_seed)}
                  </p>
                </div>
              </div>

              <div>
                <span className="block font-semibold text-slate-700 mb-1">Hyperparameters</span>
                <SafeJsonBlock rawValue={selectedJob.hyperparameters} />
              </div>

              <div>
                <span className="block font-semibold text-slate-700 mb-1">Evaluation Metrics</span>
                <SafeJsonBlock rawValue={selectedJob.metrics} emptyLabel="No metrics recorded" />
              </div>

              {selectedJob.error_message && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800 font-mono break-all">
                  Error: {selectedJob.error_message}
                </div>
              )}

              <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Created At:</span>
                  <span className="text-slate-800">{formatModelTimestamp(selectedJob.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Started At:</span>
                  <span className="text-slate-800">{formatModelTimestamp(selectedJob.started_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Completed At:</span>
                  <span className="text-slate-800">{formatModelTimestamp(selectedJob.completed_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Duration:</span>
                  <span className="font-mono text-slate-800">
                    {calculateJobDuration(selectedJob.started_at, selectedJob.completed_at)}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 flex items-start gap-2">
                <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
                <span>Per-job execution logs are not exposed via an admin API endpoint.</span>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
