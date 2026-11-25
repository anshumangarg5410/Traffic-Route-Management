/**
 * Pure utility functions for Admin System & Worker Status Monitoring (Phase 11.5.6.3).
 */

export const POLL_INTERVAL_MS = 30000;

export function formatSystemTimestamp(isoString) {
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

export function classifyHealthStatus({ loading, data, error }) {
  if (loading && !data && !error) {
    return { key: "loading", label: "Checking...", tone: "neutral" };
  }
  if (error) {
    return { key: "unavailable", label: "Unavailable", tone: "danger", message: "Backend health endpoint unavailable." };
  }
  if (data?.status === "healthy") {
    return { key: "available", label: "Available (Liveness)", tone: "success" };
  }
  return { key: "unknown", label: "Unknown / Unable to Verify", tone: "warning" };
}

export function classifyWorkersStatus({ loading, data, error }) {
  if (loading && !data && !error) {
    return { key: "loading", label: "Checking...", tone: "neutral" };
  }
  if (error) {
    return { key: "unavailable", label: "Unavailable", tone: "danger", message: "Worker status endpoint unavailable." };
  }
  const workers = Array.isArray(data?.workers) ? data.workers : [];
  if (workers.length === 0) {
    return { key: "empty", label: "No Workers Registered", tone: "neutral" };
  }
  const hasFailure = workers.some((w) => w.status === "LOAD_FAILED" || w.status === "CHECKSUM_MISMATCH");
  if (hasFailure) {
    return { key: "failed", label: "Worker Load Error", tone: "danger" };
  }
  const hasStale = workers.some((w) => Boolean(w.is_stale));
  if (hasStale) {
    return { key: "stale", label: "Stale Heartbeat", tone: "warning" };
  }
  return { key: "available", label: "Available", tone: "success" };
}

export function classifyNetworkStatus({ loading, data, error }) {
  if (loading && !data && !error) {
    return { key: "loading", label: "Checking...", tone: "neutral" };
  }
  if (error) {
    return { key: "unavailable", label: "Unavailable", tone: "danger", message: "Road-network graph unavailable." };
  }
  if (data?.available_locally === true && data?.status === "ready") {
    return { key: "available", label: "Available (Local Graph)", tone: "success" };
  }
  if (data?.available_locally === false) {
    return { key: "unavailable", label: "Graph Unavailable", tone: "warning" };
  }
  return { key: "unknown", label: "Unknown / Unable to Verify", tone: "warning" };
}

export function classifyProviderStatus({ loading, data, error }) {
  if (loading && !data && !error) {
    return { key: "loading", label: "Checking...", tone: "neutral" };
  }
  if (error) {
    return { key: "unavailable", label: "Unavailable", tone: "danger", message: "Provider configuration unavailable." };
  }
  if (data?.provider_status === "configured") {
    return { key: "configured", label: "Configured (Unprobed)", tone: "info" };
  }
  if (!data || !data.provider_status) {
    return { key: "not_configured", label: "Not Configured", tone: "warning" };
  }
  return { key: "unknown", label: String(data.provider_status), tone: "neutral" };
}
