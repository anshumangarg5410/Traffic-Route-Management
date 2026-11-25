import { useState, useEffect, useRef, useCallback } from "react";
import {
  ScrollText,
  RefreshCw,
  AlertTriangle,
  Filter,
  FilterX,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  User as UserIcon,
  Target,
  ChevronDown,
  ChevronUp,
  Layers,
} from "lucide-react";
import { getAdminAuditLogs } from "../../services/api";
import {
  SUPPORTED_AUDIT_ACTIONS,
  validateAuditFilters,
  toUtcIsoString,
  formatAuditTimestamp,
  formatAuditDetails,
  computeAuditPagination,
} from "../../utils/auditLogUtils";

const PAGE_LIMIT = 50;

const INITIAL_FILTERS = {
  action: "all",
  actorId: "",
  targetEntity: "",
  startDate: "",
  endDate: "",
};

const ACTION_BADGE_STYLES = {
  USER_ROLE_CHANGE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  USER_STATUS_CHANGE: "bg-amber-50 text-amber-800 border-amber-200",
  MODEL_DEPLOY: "bg-violet-50 text-violet-700 border-violet-200",
  MODEL_ROLLBACK: "bg-rose-50 text-rose-700 border-rose-200",
  NETWORK_BUILD: "bg-teal-50 text-teal-700 border-teal-200",
  DATASET_INGEST: "bg-sky-50 text-sky-700 border-sky-200",
};

function AuditDetailsCell({ rawDetails }) {
  const [expanded, setExpanded] = useState(false);
  const { kind, formatted, preview, isLarge } = formatAuditDetails(rawDetails);

  if (kind === "empty") {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <div className="space-y-1 max-w-md">
      {expanded || !isLarge ? (
        <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 border border-slate-200/80">
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
        >
          {expanded ? (
            <>
              <ChevronUp size={12} />
              <span>Collapse</span>
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              <span>Expand full details</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default function AdminAuditLogs() {
  const [auditData, setAuditData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Separate draft inputs from applied query filters to avoid requests while typing
  const [draftFilters, setDraftFilters] = useState(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
  const [validationErrors, setValidationErrors] = useState({});
  const [offset, setOffset] = useState(0);

  // Monotonic sequence ID to ignore stale overlapping responses
  const latestRequestIdRef = useRef(0);

  const fetchAuditLogs = useCallback(async (filtersToUse, offsetToUse, manualRefresh = false) => {
    const requestId = ++latestRequestIdRef.current;
    if (manualRefresh) {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const data = await getAdminAuditLogs({
        action: filtersToUse.action,
        actor_id: filtersToUse.actorId,
        target_entity: filtersToUse.targetEntity,
        start_date: toUtcIsoString(filtersToUse.startDate),
        end_date: toUtcIsoString(filtersToUse.endDate),
        limit: PAGE_LIMIT,
        offset: offsetToUse,
      });

      if (requestId !== latestRequestIdRef.current) return;
      setAuditData(data);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      setError(err.message || "Failed to retrieve administrative audit logs.");
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const requestId = ++latestRequestIdRef.current;

    async function load() {
      try {
        const data = await getAdminAuditLogs({
          action: appliedFilters.action,
          actor_id: appliedFilters.actorId,
          target_entity: appliedFilters.targetEntity,
          start_date: toUtcIsoString(appliedFilters.startDate),
          end_date: toUtcIsoString(appliedFilters.endDate),
          limit: PAGE_LIMIT,
          offset,
        });

        if (ignore || requestId !== latestRequestIdRef.current) return;
        setAuditData(data);
        setError(null);
      } catch (err) {
        if (ignore || requestId !== latestRequestIdRef.current) return;
        setError(err.message || "Failed to retrieve administrative audit logs.");
      } finally {
        if (!ignore && requestId === latestRequestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [appliedFilters, offset]);

  const handleApplyFilters = (e) => {
    e.preventDefault();
    const validation = validateAuditFilters(draftFilters);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors({});
    setIsLoading(true);
    setOffset(0);
    setAppliedFilters({ ...draftFilters });
  };

  const handleClearFilters = () => {
    setValidationErrors({});
    setDraftFilters(INITIAL_FILTERS);
    setIsLoading(true);
    setOffset(0);
    setAppliedFilters(INITIAL_FILTERS);
  };

  const handleRefresh = () => {
    fetchAuditLogs(appliedFilters, offset, true);
  };

  const items = auditData?.items || [];
  const total = auditData?.total;
  const pagination = computeAuditPagination(total ?? 0, auditData?.limit ?? PAGE_LIMIT, offset, items.length);

  // Distinct action categories present in the returned page
  const pageActionCategories = Array.from(new Set(items.map((item) => item.action)));

  const hasActiveFilters =
    appliedFilters.action !== "all" ||
    appliedFilters.actorId.trim() !== "" ||
    appliedFilters.targetEntity.trim() !== "" ||
    appliedFilters.startDate !== "" ||
    appliedFilters.endDate !== "";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                <ScrollText size={20} />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Administrative Audit Trail
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Read-only ledger of recorded administrative mutations, actor identities, targets, and timestamps.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw
                size={13}
                className={isRefreshing ? "animate-spin text-indigo-600" : "text-slate-500"}
              />
              <span>{isRefreshing ? "Refreshing..." : "Refresh Logs"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section A: Summary Cards Derived Strictly from API Response */}
      <section aria-label="Audit Log Summary">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Matching Records
            </span>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {total !== undefined && total !== null ? total.toLocaleString() : "Unavailable"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Total entries matching current query</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Records on Page
            </span>
            <p className="mt-2 text-2xl font-bold text-indigo-700">
              {auditData ? items.length.toLocaleString() : "Unavailable"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Page {pagination.currentPage} of {pagination.totalPages} (limit {PAGE_LIMIT})
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Actions on This Page
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!auditData ? (
                <span className="text-sm font-semibold text-slate-400">Unavailable</span>
              ) : pageActionCategories.length > 0 ? (
                pageActionCategories.map((act) => (
                  <span
                    key={act}
                    className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-bold border ${
                      ACTION_BADGE_STYLES[act] || "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {act}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">None in current result set</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section B: Filters */}
      <form
        onSubmit={handleApplyFilters}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
        aria-label="Audit Log Filters"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            <Filter size={14} className="text-indigo-600" />
            <span>Filter Audit Trail</span>
          </div>
          <span className="text-[11px] text-slate-400">
            Date bounds are inclusive; Actor filter requires exact user UUID
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* Action Filter */}
          <div>
            <label htmlFor="audit-action-filter" className="block text-xs font-semibold text-slate-700 mb-1">
              Action
            </label>
            <select
              id="audit-action-filter"
              value={draftFilters.action}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, action: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">All Actions</option>
              {SUPPORTED_AUDIT_ACTIONS.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>

          {/* Actor ID (UUID) */}
          <div>
            <label htmlFor="audit-actor-id" className="block text-xs font-semibold text-slate-700 mb-1">
              Actor ID (UUID)
            </label>
            <input
              id="audit-actor-id"
              type="text"
              value={draftFilters.actorId}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, actorId: e.target.value }))}
              placeholder="32-hex or UUID"
              className={`w-full rounded-xl border bg-white px-3 py-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none ${
                validationErrors.actorId
                  ? "border-rose-400 focus:border-rose-500"
                  : "border-slate-200 focus:border-indigo-500"
              }`}
            />
          </div>

          {/* Target Entity */}
          <div>
            <label htmlFor="audit-target-entity" className="block text-xs font-semibold text-slate-700 mb-1">
              Target Entity
            </label>
            <input
              id="audit-target-entity"
              type="text"
              value={draftFilters.targetEntity}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, targetEntity: e.target.value }))}
              placeholder="e.g. user:0df9..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Start Date/Time */}
          <div>
            <label htmlFor="audit-start-date" className="block text-xs font-semibold text-slate-700 mb-1">
              Start Date & Time
            </label>
            <input
              id="audit-start-date"
              type="datetime-local"
              value={draftFilters.startDate}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, startDate: e.target.value }))}
              className={`w-full rounded-xl border bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none ${
                validationErrors.dateRange
                  ? "border-rose-400 focus:border-rose-500"
                  : "border-slate-200 focus:border-indigo-500"
              }`}
            />
          </div>

          {/* End Date/Time */}
          <div>
            <label htmlFor="audit-end-date" className="block text-xs font-semibold text-slate-700 mb-1">
              End Date & Time
            </label>
            <input
              id="audit-end-date"
              type="datetime-local"
              value={draftFilters.endDate}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, endDate: e.target.value }))}
              className={`w-full rounded-xl border bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none ${
                validationErrors.dateRange
                  ? "border-rose-400 focus:border-rose-500"
                  : "border-slate-200 focus:border-indigo-500"
              }`}
            />
          </div>
        </div>

        {/* Validation Messages */}
        {(validationErrors.actorId || validationErrors.dateRange) && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 flex items-start gap-2"
          >
            <AlertTriangle size={15} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {validationErrors.actorId && <p>{validationErrors.actorId}</p>}
              {validationErrors.dateRange && <p>{validationErrors.dateRange}</p>}
            </div>
          </div>
        )}

        {/* Filter Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleClearFilters}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
          >
            <FilterX size={13} />
            <span>Clear Filters</span>
          </button>

          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer"
          >
            <Filter size={13} />
            <span>Apply Filters</span>
          </button>
        </div>
      </form>

      {/* Section C & D: Audit Records Container */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {/* API Error State */}
        {error && (
          <div
            role="alert"
            className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-3"
          >
            <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-700">
                Audit Log Fetch Error
              </p>
              <p className="text-sm mt-0.5">{error}</p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="p-5 space-y-3 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && items.length === 0 && (
          <div className="p-10 text-center">
            <Layers size={28} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-bold text-slate-800">
              No audit log records found
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              {hasActiveFilters
                ? "No recorded events match the selected action, actor UUID, target entity, or date range."
                : "No administrative audit records are currently stored."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
              >
                <FilterX size={13} />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        )}

        {/* Desktop Table */}
        {!isLoading && !error && items.length > 0 && (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3.5">Timestamp</th>
                    <th className="px-4 py-3.5">Action</th>
                    <th className="px-4 py-3.5">Actor</th>
                    <th className="px-4 py-3.5">Target Entity</th>
                    <th className="px-4 py-3.5">IP Address</th>
                    <th className="px-5 py-3.5">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 align-top">
                  {items.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3.5 whitespace-nowrap text-slate-600">
                        {formatAuditTimestamp(log.created_at)}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-bold border ${
                            ACTION_BADGE_STYLES[log.action] || "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {log.actor_name || log.actor_email ? (
                          <div>
                            {log.actor_name && (
                              <p className="font-semibold text-slate-900">{log.actor_name}</p>
                            )}
                            {log.actor_email && (
                              <p className="font-mono text-[11px] text-slate-500">{log.actor_email}</p>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-500">
                            {log.actor_id || "System / Unattributed"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-700 break-all max-w-[200px]">
                        {log.target_entity}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.ip_address || "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <AuditDetailsCell rawDetails={log.details} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Responsive Mobile / Tablet Cards */}
            <div className="lg:hidden divide-y divide-slate-100">
              {items.map((log) => (
                <div key={log.id} className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-bold border ${
                        ACTION_BADGE_STYLES[log.action] || "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Clock size={12} />
                      <span>{formatAuditTimestamp(log.created_at)}</span>
                    </span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex items-start gap-1.5 text-slate-700">
                      <UserIcon size={13} className="text-slate-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 break-all">
                        {log.actor_name && <span className="font-semibold text-slate-900 mr-1.5">{log.actor_name}</span>}
                        <span className="font-mono text-[11px] text-slate-500">
                          {log.actor_email || log.actor_id || "System / Unattributed"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-1.5 text-slate-700">
                      <Target size={13} className="text-slate-400 shrink-0 mt-0.5" />
                      <span className="font-mono text-[11px] break-all">{log.target_entity}</span>
                    </div>

                    {log.ip_address && (
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Globe size={13} className="text-slate-400 shrink-0" />
                        <span className="font-mono text-[11px]">{log.ip_address}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-1">
                    <AuditDetailsCell rawDetails={log.details} />
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Footer */}
            <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Showing <span className="font-semibold text-slate-900">{pagination.startRow}</span>–
                <span className="font-semibold text-slate-900">{pagination.endRow}</span> of{" "}
                <span className="font-semibold text-slate-900">{total ?? 0}</span> records
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsLoading(true);
                    setOffset(Math.max(0, offset - PAGE_LIMIT));
                  }}
                  disabled={!pagination.canPrev || isLoading}
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
                    setIsLoading(true);
                    setOffset(offset + PAGE_LIMIT);
                  }}
                  disabled={!pagination.canNext || isLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
