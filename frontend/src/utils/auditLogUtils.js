/**
 * Pure utility functions for the Admin Audit Log Viewer (Phase 11.5.6.2).
 * Safe for both React browser runtime and Node.js unit tests.
 */

export const SUPPORTED_AUDIT_ACTIONS = [
  "USER_ROLE_CHANGE",
  "USER_STATUS_CHANGE",
  "MODEL_DEPLOY",
  "MODEL_ROLLBACK",
  "NETWORK_BUILD",
  "DATASET_INGEST",
];

// Matches both 32-char hex UUIDs (uuid.uuid4().hex) and standard 36-char hyphenated UUIDs
const UUID_HEX_32_REGEX = /^[0-9a-f]{32}$/i;
const UUID_HYPHENATED_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  return UUID_HEX_32_REGEX.test(trimmed) || UUID_HYPHENATED_REGEX.test(trimmed);
}

export function validateAuditFilters({ actorId = "", startDate = "", endDate = "" } = {}) {
  const errors = {};
  const trimmedActor = typeof actorId === "string" ? actorId.trim() : "";

  if (trimmedActor && !isValidUuid(trimmedActor)) {
    errors.actorId =
      "Actor ID must be a valid UUID (32-character hex or standard 8-4-4-4-12 format).";
  }

  if (startDate && endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      errors.dateRange = "Please provide valid start and end date/time values.";
    } else if (startMs > endMs) {
      errors.dateRange = "Start date/time must be earlier than or equal to end date/time.";
    }
  } else if (startDate && Number.isNaN(new Date(startDate).getTime())) {
    errors.dateRange = "Start date/time is invalid.";
  } else if (endDate && Number.isNaN(new Date(endDate).getTime())) {
    errors.dateRange = "End date/time is invalid.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function toUtcIsoString(localDateTimeValue) {
  if (!localDateTimeValue || typeof localDateTimeValue !== "string") return undefined;
  const trimmed = localDateTimeValue.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function formatAuditTimestamp(isoString) {
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

export function formatAuditDetails(rawDetails) {
  if (rawDetails === null || rawDetails === undefined || rawDetails === "") {
    return { kind: "empty", formatted: "—", preview: "—", isLarge: false };
  }

  const text = typeof rawDetails === "string" ? rawDetails.trim() : String(rawDetails);
  if (!text) {
    return { kind: "empty", formatted: "—", preview: "—", isLarge: false };
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      const pretty = JSON.stringify(parsed, null, 2);
      const compact = JSON.stringify(parsed);
      const isLarge = compact.length > 140 || pretty.split("\n").length > 5;
      const preview = compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
      return { kind: "json", formatted: pretty, preview, isLarge };
    }
  } catch {
    // Not JSON; fall through to safe plain-text handling
  }

  const isLarge = text.length > 140;
  const preview = isLarge ? `${text.slice(0, 137)}...` : text;
  return { kind: "text", formatted: text, preview, isLarge };
}

export function computeAuditPagination(total, limit, offset, itemsCount) {
  const safeLimit = Math.max(1, Number(limit) || 50);
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
