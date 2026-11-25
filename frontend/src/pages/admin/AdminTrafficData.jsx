import { useState, useEffect, useRef, useCallback } from "react";
import {
  Database,
  RefreshCw,
  AlertTriangle,
  Info,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Layers,
  ShieldAlert,
  FileWarning,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import {
  getAdminTrafficBatches,
  getAdminTrafficQuality,
} from "../../services/api";
import {
  TRAFFIC_SOURCE_TYPES,
  getSourceTypeMeta,
  calculateAcceptanceRate,
  aggregateBatchPageStats,
  formatSourceBreakdown,
  safeParseRawPayload,
  formatTrafficTimestamp,
  computeTrafficPagination,
} from "../../utils/trafficMonitoringUtils";

const PAGE_LIMIT = 20;

const QUALITY_EVENT_CLASSES = {
  SAMPLING_GAP: "bg-amber-50 text-amber-800 border-amber-200",
  DETECTOR_OFFLINE: "bg-rose-50 text-rose-700 border-rose-200",
  HARDWARE_FAULT: "bg-rose-50 text-rose-700 border-rose-200",
};

function SafePayloadCell({ rawValue, label = "raw payload" }) {
  const [expanded, setExpanded] = useState(false);
  const { kind, formatted, preview, isLarge } = safeParseRawPayload(rawValue);

  if (kind === "empty") {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <div className="space-y-1 max-w-md">
      {expanded || !isLarge ? (
        <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 border border-slate-200 max-h-48 overflow-y-auto">
          {formatted}
        </pre>
      ) : (
        <p className="font-mono text-[11px] text-slate-600 break-all">{preview}</p>
      )}

      {isLarge && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        >
          {expanded ? (
            <>
              <ChevronUp size={12} />
              <span>Collapse</span>
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              <span>Expand {label}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default function AdminTrafficData() {
  const [batchesState, setBatchesState] = useState({
    loading: true,
    data: null,
    error: null,
  });
  const [qualityState, setQualityState] = useState({
    loading: true,
    data: null,
    error: null,
  });

  const [sourceFilter, setSourceFilter] = useState("all");
  const [batchesOffset, setBatchesOffset] = useState(0);
  const [qualityOffset, setQualityOffset] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [selectedBatch, setSelectedBatch] = useState(null);

  const batchesReqIdRef = useRef(0);
  const qualityReqIdRef = useRef(0);

  const fetchBatches = useCallback(async (sourceToUse, offsetToUse) => {
    const reqId = ++batchesReqIdRef.current;
    try {
      const data = await getAdminTrafficBatches({
        source_type: sourceToUse,
        limit: PAGE_LIMIT,
        offset: offsetToUse,
      });
      if (reqId !== batchesReqIdRef.current) return;
      setBatchesState({ loading: false, data, error: null });
    } catch (err) {
      if (reqId !== batchesReqIdRef.current) return;
      setBatchesState({
        loading: false,
        data: null,
        error: err.message || "Failed to load traffic ingestion batches.",
      });
    }
  }, []);

  const fetchQuality = useCallback(async (offsetToUse) => {
    const reqId = ++qualityReqIdRef.current;
    try {
      const data = await getAdminTrafficQuality({
        limit: PAGE_LIMIT,
        offset: offsetToUse,
      });
      if (reqId !== qualityReqIdRef.current) return;
      setQualityState({ loading: false, data, error: null });
    } catch (err) {
      if (reqId !== qualityReqIdRef.current) return;
      setQualityState({
        loading: false,
        data: null,
        error: err.message || "Failed to load traffic quality and rejection telemetry.",
      });
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const reqId = ++batchesReqIdRef.current;
    async function loadBatches() {
      try {
        const data = await getAdminTrafficBatches({
          source_type: sourceFilter,
          limit: PAGE_LIMIT,
          offset: batchesOffset,
        });
        if (!ignore && reqId === batchesReqIdRef.current) {
          setBatchesState({ loading: false, data, error: null });
        }
      } catch (err) {
        if (!ignore && reqId === batchesReqIdRef.current) {
          setBatchesState({
            loading: false,
            data: null,
            error: err.message || "Failed to load traffic ingestion batches.",
          });
        }
      }
    }
    loadBatches();
    return () => {
      ignore = true;
    };
  }, [sourceFilter, batchesOffset]);

  useEffect(() => {
    let ignore = false;
    const reqId = ++qualityReqIdRef.current;
    async function loadQuality() {
      try {
        const data = await getAdminTrafficQuality({
          limit: PAGE_LIMIT,
          offset: qualityOffset,
        });
        if (!ignore && reqId === qualityReqIdRef.current) {
          setQualityState({ loading: false, data, error: null });
        }
      } catch (err) {
        if (!ignore && reqId === qualityReqIdRef.current) {
          setQualityState({
            loading: false,
            data: null,
            error: err.message || "Failed to load traffic quality and rejection telemetry.",
          });
        }
      }
    }
    loadQuality();
    return () => {
      ignore = true;
    };
  }, [qualityOffset]);

  const handleRefreshAll = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await Promise.allSettled([
      fetchBatches(sourceFilter, batchesOffset),
      fetchQuality(qualityOffset),
    ]);
    setIsRefreshing(false);
  };

  const handleSourceFilterChange = (newSource) => {
    setBatchesState((prev) => ({ ...prev, loading: true, error: null }));
    setBatchesOffset(0);
    setSourceFilter(newSource);
  };

  const batches = Array.isArray(batchesState.data?.batches) ? batchesState.data.batches : [];
  const totalBatches = batchesState.data?.total;
  const batchStats = aggregateBatchPageStats(
    batchesState.data ? batches : null,
    totalBatches
  );
  const batchesPagination = computeTrafficPagination(
    totalBatches ?? 0,
    batchesState.data?.limit ?? PAGE_LIMIT,
    batchesOffset,
    batches.length
  );

  const qualityEvents = Array.isArray(qualityState.data?.quality_events)
    ? qualityState.data.quality_events
    : [];
  const rejections = Array.isArray(qualityState.data?.rejections)
    ? qualityState.data.rejections
    : [];
  const qualityEventsCount = qualityState.data?.quality_events_count;
  const rejectionsCount = qualityState.data?.rejections_count;

  const qualityMaxTotal = Math.max(qualityEventsCount ?? 0, rejectionsCount ?? 0);
  const qualityMaxPageItems = Math.max(qualityEvents.length, rejections.length);
  const qualityPagination = computeTrafficPagination(
    qualityMaxTotal,
    PAGE_LIMIT,
    qualityOffset,
    qualityMaxPageItems
  );

  const sourceBreakdownList = formatSourceBreakdown(qualityState.data?.source_breakdown);
  const scopeLabel = batchStats.isCompleteDataset ? "All matching batches" : "Current page total";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                <Database size={20} />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Traffic Ingestion & Quality
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Read-only oversight of traffic ingestion batches, data-quality events, dead-letter rejections, and source provenance.
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
            <span>{isRefreshing ? "Refreshing..." : "Refresh Telemetry"}</span>
          </button>
        </div>
      </div>

      {/* Data Source Integrity & Provenance Notice */}
      <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-xs text-sky-950 flex items-start gap-2.5">
        <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">Traffic Data Source Classification & Provenance</p>
          <p className="mt-1 leading-relaxed text-sky-900">
            Ingested batches are strictly partitioned into <code className="font-mono text-[11px] font-semibold">REAL_SENSOR</code> (verified live sensor feeds), <code className="font-mono text-[11px] font-semibold">SIMULATION_SYNTHETIC</code> (generated simulation runs), and <code className="font-mono text-[11px] font-semibold">HISTORICAL_BENCHMARK</code> (imported historical datasets such as Minnesota UCI). The presence of a batch does not indicate an active live ingestion stream.
          </p>
        </div>
      </div>

      {/* Section A: Traffic Data Overview Cards */}
      <section aria-label="Traffic Data Overview">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Ingestion Batches
            </span>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {batchesState.error
                ? "Unavailable"
                : totalBatches !== undefined && totalBatches !== null
                ? totalBatches.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Total matching batches</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Records Submitted
            </span>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {batchesState.error
                ? "Unavailable"
                : batchStats.totalRecords !== null
                ? batchStats.totalRecords.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{scopeLabel}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Accepted Records
            </span>
            <p className="mt-2 text-2xl font-bold text-emerald-700">
              {batchesState.error
                ? "Unavailable"
                : batchStats.acceptedRecords !== null
                ? batchStats.acceptedRecords.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{scopeLabel}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Rejected Records
            </span>
            <p className="mt-2 text-2xl font-bold text-rose-700">
              {batchesState.error
                ? "Unavailable"
                : batchStats.rejectedRecords !== null
                ? batchStats.rejectedRecords.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{scopeLabel}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Acceptance Rate
            </span>
            <p className="mt-2 text-2xl font-bold text-indigo-700">
              {batchesState.error
                ? "Unavailable"
                : batchStats.acceptanceRate !== null
                ? `${batchStats.acceptanceRate}%`
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {batchStats.totalRecords === 0 ? "No submitted records" : scopeLabel}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Quality Events
            </span>
            <p className="mt-2 text-2xl font-bold text-amber-700">
              {qualityState.error
                ? "Unavailable"
                : qualityEventsCount !== undefined && qualityEventsCount !== null
                ? qualityEventsCount.toLocaleString()
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Faults & sampling gaps</p>
          </div>
        </div>
      </section>

      {/* Section B: Source Breakdown */}
      <section aria-label="Traffic Source Breakdown" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
          <BarChart3 size={18} className="text-indigo-600" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Source Breakdown</h2>
            <p className="text-xs text-slate-500">
              Batch distribution across verified sensor, synthetic simulation, and historical benchmark categories
            </p>
          </div>
        </div>

        {qualityState.error && (
          <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
            <span>{qualityState.error}</span>
            <button
              type="button"
              onClick={() => fetchQuality(qualityOffset)}
              className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {qualityState.loading && !qualityState.data && !qualityState.error && (
          <div className="mt-4 h-24 rounded-xl bg-slate-100 animate-pulse" />
        )}

        {!qualityState.loading && !qualityState.error && sourceBreakdownList.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
            <Layers size={24} className="mx-auto text-slate-400" />
            <p className="mt-2 text-xs font-bold text-slate-700">
              No source breakdown data available
            </p>
            <p className="mt-1 text-xs text-slate-500">
              No ingestion batches have been recorded under <code className="font-mono text-[11px]">REAL_SENSOR</code>, <code className="font-mono text-[11px]">SIMULATION_SYNTHETIC</code>, or <code className="font-mono text-[11px]">HISTORICAL_BENCHMARK</code>.
            </p>
          </div>
        )}

        {!qualityState.error && sourceBreakdownList.length > 0 && (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
            <div className="space-y-3">
              {sourceBreakdownList.map((item) => (
                <div
                  key={item.sourceType}
                  className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 flex items-center justify-between gap-3"
                >
                  <div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${item.meta.badgeClass}`}
                    >
                      {item.meta.label}
                    </span>
                    <p className="mt-1 text-[11px] text-slate-500">{item.meta.description}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">{item.sourceType}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xl font-bold text-slate-900">{item.count.toLocaleString()}</span>
                    <p className="text-[10px] text-slate-500 uppercase">Batches</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceBreakdownList} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                  <XAxis dataKey="sourceType" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Batches" radius={[6, 6, 0, 0]}>
                    {sourceBreakdownList.map((entry) => (
                      <Cell key={entry.sourceType} fill={entry.meta.barColor} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* Section C: Ingestion Batch Table */}
      <section aria-label="Ingestion Batches" className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Ingestion Batches</h2>
            <p className="text-xs text-slate-500">
              Server-side paginated batch audit trail
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="source-type-filter" className="text-xs font-semibold text-slate-600">
              Source Type:
            </label>
            <select
              id="source-type-filter"
              value={sourceFilter}
              onChange={(e) => handleSourceFilterChange(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">All Sources</option>
              {TRAFFIC_SOURCE_TYPES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        {batchesState.error && (
          <div role="alert" className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{batchesState.error}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchBatches(sourceFilter, batchesOffset)}
              className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {batchesState.loading && !batchesState.data && !batchesState.error && (
          <div className="p-5 space-y-3 animate-pulse">
            <div className="h-12 rounded-xl bg-slate-100" />
            <div className="h-12 rounded-xl bg-slate-100" />
          </div>
        )}

        {!batchesState.loading && !batchesState.error && batches.length === 0 && (
          <div className="p-8 text-center">
            <Database size={26} className="mx-auto text-slate-400" />
            <p className="mt-2 text-sm font-bold text-slate-800">
              No ingestion batches recorded
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {sourceFilter !== "all"
                ? `No batches found for source type '${sourceFilter}'.`
                : "No traffic dataset ingestion batches exist in the database."}
            </p>
          </div>
        )}

        {!batchesState.error && batches.length > 0 && (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3.5">Batch</th>
                    <th className="px-4 py-3.5">Source Type</th>
                    <th className="px-4 py-3.5">Submitted By</th>
                    <th className="px-4 py-3.5 text-right">Total</th>
                    <th className="px-4 py-3.5 text-right">Accepted</th>
                    <th className="px-4 py-3.5 text-right">Rejected</th>
                    <th className="px-4 py-3.5 text-right">Acceptance</th>
                    <th className="px-4 py-3.5">Ingested At</th>
                    <th className="px-5 py-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {batches.map((b) => {
                    const meta = getSourceTypeMeta(b.source_type);
                    const rate = calculateAcceptanceRate(b.accepted_records, b.total_records);
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-900">{b.batch_name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{b.id}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${meta.badgeClass}`}
                          >
                            {b.source_type}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600">
                          {b.submitted_by || "System"}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono">{b.total_records}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-emerald-700">{b.accepted_records}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-rose-700">{b.rejected_records}</td>
                        <td className="px-4 py-3.5 text-right font-mono font-semibold">
                          {rate !== null ? `${rate}%` : "—"}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-slate-500">
                          {formatTrafficTimestamp(b.ingested_at)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedBatch(b)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Batch Cards */}
            <div className="lg:hidden divide-y divide-slate-100">
              {batches.map((b) => {
                const meta = getSourceTypeMeta(b.source_type);
                const rate = calculateAcceptanceRate(b.accepted_records, b.total_records);
                return (
                  <div key={b.id} className="p-4 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{b.batch_name}</p>
                        <p className="font-mono text-[10px] text-slate-400 break-all">{b.id}</p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0 ${meta.badgeClass}`}
                      >
                        {b.source_type}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>Total: <span className="font-mono font-semibold">{b.total_records}</span></div>
                      <div className="text-emerald-700">Acc: <span className="font-mono font-semibold">{b.accepted_records}</span></div>
                      <div className="text-rose-700">Rej: <span className="font-mono font-semibold">{b.rejected_records}</span></div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-500">
                        Rate: {rate !== null ? `${rate}%` : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedBatch(b)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                      >
                        <Eye size={12} />
                        <span>Inspect</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Showing <span className="font-semibold text-slate-900">{batchesPagination.startRow}</span>–
                <span className="font-semibold text-slate-900">{batchesPagination.endRow}</span> of{" "}
                <span className="font-semibold text-slate-900">{totalBatches ?? 0}</span> batches
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBatchesState((prev) => ({ ...prev, loading: true }));
                    setBatchesOffset(Math.max(0, batchesOffset - PAGE_LIMIT));
                  }}
                  disabled={!batchesPagination.canPrev || batchesState.loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>
                <span className="px-2 font-medium text-slate-700">
                  Page {batchesPagination.currentPage} of {batchesPagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBatchesState((prev) => ({ ...prev, loading: true }));
                    setBatchesOffset(batchesOffset + PAGE_LIMIT);
                  }}
                  disabled={!batchesPagination.canNext || batchesState.loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Section D & E: Data-Quality Events & Ingestion Rejections */}
      <div className="space-y-6">
        {/* Data-Quality Events */}
        <section aria-label="Data-Quality Events" className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-amber-600" />
              <h2 className="text-sm font-bold text-slate-900">Data-Quality Events</h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Total: {qualityState.error ? "Unavailable" : qualityEventsCount ?? "—"}
            </span>
          </div>

          {!qualityState.loading && !qualityState.error && qualityEvents.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-xs font-bold text-slate-700">No data-quality events recorded</p>
              <p className="mt-1 text-xs text-slate-500">
                No <code className="font-mono text-[11px]">SAMPLING_GAP</code>, <code className="font-mono text-[11px]">DETECTOR_OFFLINE</code>, or <code className="font-mono text-[11px]">HARDWARE_FAULT</code> events exist.
              </p>
            </div>
          )}

          {!qualityState.error && qualityEvents.length > 0 && (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-5 py-3">Event ID</th>
                      <th className="px-4 py-3">Source Identifier</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Window (Start → End)</th>
                      <th className="px-4 py-3 text-right">Missing Intervals</th>
                      <th className="px-4 py-3">Created At</th>
                      <th className="px-5 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 align-top">
                    {qualityEvents.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-mono text-[11px]">{ev.id}</td>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">{ev.source_identifier}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${
                              QUALITY_EVENT_CLASSES[ev.event_type] || "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {ev.event_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-600">
                          <div>{formatTrafficTimestamp(ev.event_start)}</div>
                          <div className="text-slate-400">→ {formatTrafficTimestamp(ev.event_end)}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {ev.missing_intervals !== null && ev.missing_intervals !== undefined
                            ? ev.missing_intervals
                            : "Unavailable"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                          {formatTrafficTimestamp(ev.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <SafePayloadCell rawValue={ev.details} label="event details" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-slate-100">
                {qualityEvents.map((ev) => (
                  <div key={ev.id} className="p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-900">{ev.source_identifier}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                          QUALITY_EVENT_CLASSES[ev.event_type] || "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {ev.event_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Missing intervals:{" "}
                      {ev.missing_intervals !== null && ev.missing_intervals !== undefined
                        ? ev.missing_intervals
                        : "Unavailable"}
                    </div>
                    <SafePayloadCell rawValue={ev.details} label="event details" />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Ingestion Rejections */}
        <section aria-label="Ingestion Rejections" className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileWarning size={18} className="text-rose-600" />
              <h2 className="text-sm font-bold text-slate-900">Dead-Letter Ingestion Rejections</h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Total: {qualityState.error ? "Unavailable" : rejectionsCount ?? "—"}
            </span>
          </div>

          {!qualityState.loading && !qualityState.error && rejections.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-xs font-bold text-slate-700">No rejected ingestion records</p>
              <p className="mt-1 text-xs text-slate-500">
                Dead-letter validation rejections will appear here when malformed or out-of-range records are rejected.
              </p>
            </div>
          )}

          {!qualityState.error && rejections.length > 0 && (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-5 py-3">Rejection ID</th>
                      <th className="px-4 py-3">Batch ID</th>
                      <th className="px-4 py-3">Rejection Reason</th>
                      <th className="px-4 py-3">Created At</th>
                      <th className="px-5 py-3">Raw Record</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 align-top">
                    {rejections.map((rej) => (
                      <tr key={rej.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-mono text-[11px]">{rej.id}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{rej.batch_id || "—"}</td>
                        <td className="px-4 py-3 text-rose-800 font-medium">{rej.rejection_reason}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                          {formatTrafficTimestamp(rej.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <SafePayloadCell rawValue={rej.raw_record} label="raw record" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-slate-100">
                {rejections.map((rej) => (
                  <div key={rej.id} className="p-4 space-y-2 text-xs">
                    <div className="font-mono text-[11px] text-slate-500">{rej.id}</div>
                    <div className="font-semibold text-rose-800">{rej.rejection_reason}</div>
                    <SafePayloadCell rawValue={rej.raw_record} label="raw record" />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Shared Quality & Rejections Pagination Footer */}
          {!qualityState.error && qualityMaxTotal > 0 && (
            <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Quality Page {qualityPagination.currentPage} of {qualityPagination.totalPages} (
                {qualityEventsCount ?? 0} events, {rejectionsCount ?? 0} rejections total)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setQualityState((prev) => ({ ...prev, loading: true }));
                    setQualityOffset(Math.max(0, qualityOffset - PAGE_LIMIT));
                  }}
                  disabled={!qualityPagination.canPrev || qualityState.loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQualityState((prev) => ({ ...prev, loading: true }));
                    setQualityOffset(qualityOffset + PAGE_LIMIT);
                  }}
                  disabled={!qualityPagination.canNext || qualityState.loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Batch Details Modal (derived strictly from list endpoint fields) */}
      {selectedBatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-details-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 id="batch-details-title" className="text-base font-bold text-slate-900">
                Ingestion Batch Details
              </h2>
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 cursor-pointer"
                aria-label="Close batch details"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <p className="text-base font-bold text-slate-900">{selectedBatch.batch_name}</p>
                <p className="font-mono text-slate-500 break-all">{selectedBatch.id}</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <span className="text-slate-500">Total</span>
                  <p className="mt-1 text-lg font-bold text-slate-900">{selectedBatch.total_records}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-100">
                  <span className="text-emerald-700">Accepted</span>
                  <p className="mt-1 text-lg font-bold text-emerald-800">{selectedBatch.accepted_records}</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-3 border border-rose-100">
                  <span className="text-rose-700">Rejected</span>
                  <p className="mt-1 text-lg font-bold text-rose-800">{selectedBatch.rejected_records}</p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Source Type:</span>
                  <span className="font-mono font-semibold text-slate-800">{selectedBatch.source_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Submitted By:</span>
                  <span className="font-mono text-slate-800">{selectedBatch.submitted_by || "System"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Acceptance Rate:</span>
                  <span className="font-mono font-semibold text-indigo-700">
                    {calculateAcceptanceRate(selectedBatch.accepted_records, selectedBatch.total_records) !== null
                      ? `${calculateAcceptanceRate(selectedBatch.accepted_records, selectedBatch.total_records)}%`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ingested At:</span>
                  <span className="text-slate-800">{formatTrafficTimestamp(selectedBatch.ingested_at)}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
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
