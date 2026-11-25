/**
 * Pure utility functions for ML Model Governance & Training Job Monitoring (Phase 11.5.6.4).
 */

export const TRAINING_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export function safeJsonParse(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { ok: true, isEmpty: true, value: null, formatted: "—" };
  }
  if (typeof rawValue === "object") {
    return {
      ok: true,
      isEmpty: false,
      value: rawValue,
      formatted: JSON.stringify(rawValue, null, 2),
    };
  }
  const text = String(rawValue).trim();
  if (!text) {
    return { ok: true, isEmpty: true, value: null, formatted: "—" };
  }
  try {
    const parsed = JSON.parse(text);
    return {
      ok: true,
      isEmpty: false,
      value: parsed,
      formatted: typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed, null, 2) : String(parsed),
    };
  } catch {
    return {
      ok: false,
      isEmpty: false,
      value: null,
      raw: text,
      formatted: text,
      error: "Malformed JSON payload",
    };
  }
}

export function formatModelMetricValue(val) {
  if (val === null || val === undefined || val === "") return "Unavailable";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "Unavailable";
    return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof val === "boolean") return String(val);
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function formatModelTimestamp(isoString) {
  if (!isoString || typeof isoString !== "string") return "—";
  try {
    const hasTz = /([zZ]|[+-]\d{2}:\d{2})$/.test(isoString);
    const d = new Date(hasTz ? isoString : `${isoString}Z`);
    if (Number.isNaN(d.getTime())) return isoString;
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

export function calculateJobDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return "—";
  try {
    const startHasTz = /([zZ]|[+-]\d{2}:\d{2})$/.test(startedAt);
    const endHasTz = /([zZ]|[+-]\d{2}:\d{2})$/.test(completedAt);
    const startMs = new Date(startHasTz ? startedAt : `${startedAt}Z`).getTime();
    const endMs = new Date(endHasTz ? completedAt : `${completedAt}Z`).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
      return "—";
    }
    const totalSeconds = Math.floor((endMs - startMs) / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  } catch {
    return "—";
  }
}

export function summarizeModelRegistry(models) {
  if (!Array.isArray(models)) {
    return {
      total: null,
      activeCount: null,
      pendingReviewCount: null,
      approvedCount: null,
      rejectedCount: null,
    };
  }
  let activeCount = 0;
  let pendingReviewCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;

  for (const m of models) {
    if (m.is_active === 1) activeCount += 1;
    if (m.review_status === "PENDING_REVIEW") pendingReviewCount += 1;
    else if (m.review_status === "APPROVED") approvedCount += 1;
    else if (m.review_status === "REJECTED") rejectedCount += 1;
  }

  return {
    total: models.length,
    activeCount,
    pendingReviewCount,
    approvedCount,
    rejectedCount,
  };
}

export function computeJobsPagination(total, limit, offset, itemsCount) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(totalPages, Math.floor(safeOffset / safeLimit) + 1);
  const startRow = safeTotal === 0 || itemsCount === 0 ? 0 : safeOffset + 1;
  const endRow = safeTotal === 0 || itemsCount === 0 ? 0 : Math.min(safeOffset + itemsCount, safeTotal);

  return {
    totalPages,
    currentPage,
    startRow,
    endRow,
    canPrev: safeOffset > 0,
    canNext: safeOffset + safeLimit < safeTotal,
  };
}
