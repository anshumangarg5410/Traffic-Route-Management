/**
 * Pure utility functions for Traffic Data Ingestion & Quality Monitoring (Phase 11.5.6.5).
 */

export const TRAFFIC_SOURCE_TYPES = [
  "REAL_SENSOR",
  "SIMULATION_SYNTHETIC",
  "HISTORICAL_BENCHMARK",
];

export const SOURCE_TYPE_METADATA = {
  REAL_SENSOR: {
    label: "Real Sensor",
    description: "Actual sensor-originated observations (only when verified)",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    barColor: "#059669",
  },
  SIMULATION_SYNTHETIC: {
    label: "Simulation (Synthetic)",
    description: "Generated simulation traffic data",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
    barColor: "#7c3aed",
  },
  HISTORICAL_BENCHMARK: {
    label: "Historical Benchmark",
    description: "Imported historical datasets for benchmarking (not live sensor data)",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    barColor: "#0284c7",
  },
};

export function getSourceTypeMeta(sourceType) {
  if (sourceType && SOURCE_TYPE_METADATA[sourceType]) {
    return SOURCE_TYPE_METADATA[sourceType];
  }
  return {
    label: sourceType || "Unknown Source",
    description: "Unrecognized traffic data source category",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    barColor: "#64748b",
  };
}

export function calculateAcceptanceRate(acceptedRecords, totalRecords) {
  if (
    acceptedRecords === null ||
    acceptedRecords === undefined ||
    totalRecords === null ||
    totalRecords === undefined
  ) {
    return null;
  }
  const total = Number(totalRecords);
  const accepted = Number(acceptedRecords);
  if (!Number.isFinite(total) || !Number.isFinite(accepted) || total <= 0) {
    return null;
  }
  const pct = (accepted / total) * 100;
  return Math.round(pct * 10) / 10;
}

export function aggregateBatchPageStats(batches, totalBatches) {
  if (!Array.isArray(batches)) {
    return {
      totalRecords: null,
      acceptedRecords: null,
      rejectedRecords: null,
      acceptanceRate: null,
      isCompleteDataset: false,
    };
  }

  let totalRecords = 0;
  let acceptedRecords = 0;
  let rejectedRecords = 0;

  for (const b of batches) {
    totalRecords += Number(b.total_records) || 0;
    acceptedRecords += Number(b.accepted_records) || 0;
    rejectedRecords += Number(b.rejected_records) || 0;
  }

  const isCompleteDataset =
    totalBatches !== null &&
    totalBatches !== undefined &&
    batches.length === Number(totalBatches);

  return {
    totalRecords,
    acceptedRecords,
    rejectedRecords,
    acceptanceRate: calculateAcceptanceRate(acceptedRecords, totalRecords),
    isCompleteDataset,
  };
}

export function formatSourceBreakdown(sourceBreakdown) {
  if (!sourceBreakdown || typeof sourceBreakdown !== "object") {
    return [];
  }
  return Object.entries(sourceBreakdown).map(([sourceType, count]) => ({
    sourceType,
    count: Number(count) || 0,
    meta: getSourceTypeMeta(sourceType),
  }));
}

export function safeParseRawPayload(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { kind: "empty", formatted: "—", preview: "—", isLarge: false };
  }
  if (typeof rawValue === "object") {
    const pretty = JSON.stringify(rawValue, null, 2);
    const compact = JSON.stringify(rawValue);
    const isLarge = compact.length > 120 || pretty.split("\n").length > 4;
    return {
      kind: "json",
      formatted: pretty,
      preview: compact.length > 120 ? `${compact.slice(0, 117)}...` : compact,
      isLarge,
    };
  }

  const text = String(rawValue).trim();
  if (!text) {
    return { kind: "empty", formatted: "—", preview: "—", isLarge: false };
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      const pretty = JSON.stringify(parsed, null, 2);
      const compact = JSON.stringify(parsed);
      const isLarge = compact.length > 120 || pretty.split("\n").length > 4;
      return {
        kind: "json",
        formatted: pretty,
        preview: compact.length > 120 ? `${compact.slice(0, 117)}...` : compact,
        isLarge,
      };
    }
  } catch {
    // Malformed JSON -> render safely as escaped plain text
  }

  const isLarge = text.length > 120;
  return {
    kind: "text",
    formatted: text,
    preview: isLarge ? `${text.slice(0, 117)}...` : text,
    isLarge,
  };
}

export function formatTrafficTimestamp(isoString) {
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

export function computeTrafficPagination(total, limit, offset, itemsCount) {
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
