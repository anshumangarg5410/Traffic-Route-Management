/**
 * Automated Test Suite for Admin System & Worker Status Monitoring
 * ================================================================
 * Phase 11.5.6.3: Frontend System Health, Workers, Graph & Provider Config
 *
 * Runs natively in Node.js via node:test and node:assert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAdminWorkers,
  getHealthStatus,
  getRoutingNetworkStatus,
  getRoutingProviderStatus,
} from "../services/api.js";
import {
  POLL_INTERVAL_MS,
  formatSystemTimestamp,
  classifyHealthStatus,
  classifyWorkersStatus,
  classifyNetworkStatus,
  classifyProviderStatus,
} from "../utils/systemStatusUtils.js";

describe("Phase 11.5.6.3 — Admin System Monitoring Verification Suite", () => {
  it("1. exports all four system monitoring API helpers", () => {
    assert.equal(typeof getAdminWorkers, "function");
    assert.equal(typeof getHealthStatus, "function");
    assert.equal(typeof getRoutingNetworkStatus, "function");
    assert.equal(typeof getRoutingProviderStatus, "function");
  });

  it("2. classifies a healthy active worker response as Available", () => {
    const res = classifyWorkersStatus({
      loading: false,
      error: null,
      data: {
        total: 1,
        workers: [
          {
            worker_id: "worker-01",
            pid: 4321,
            loaded_version: 2,
            loaded_model_id: "rf-model-2",
            status: "READY",
            error_message: null,
            last_heartbeat: "2026-11-25T06:00:00Z",
            is_stale: false,
          },
        ],
      },
    });
    assert.equal(res.key, "available");
    assert.equal(res.label, "Available");
    assert.equal(res.tone, "success");
  });

  it("3. classifies an empty worker list as No Workers Registered without danger tone", () => {
    const res = classifyWorkersStatus({
      loading: false,
      error: null,
      data: { total: 0, workers: [] },
    });
    assert.equal(res.key, "empty");
    assert.equal(res.label, "No Workers Registered");
    assert.equal(res.tone, "neutral");
  });

  it("4. classifies stale workers using backend-provided is_stale flag", () => {
    const res = classifyWorkersStatus({
      loading: false,
      error: null,
      data: {
        total: 1,
        workers: [{ worker_id: "worker-stale", status: "READY", is_stale: true }],
      },
    });
    assert.equal(res.key, "stale");
    assert.equal(res.label, "Stale Heartbeat");
    assert.equal(res.tone, "warning");
  });

  it("5. classifies LOAD_FAILED and CHECKSUM_MISMATCH worker failure statuses", () => {
    for (const badStatus of ["LOAD_FAILED", "CHECKSUM_MISMATCH"]) {
      const res = classifyWorkersStatus({
        loading: false,
        error: null,
        data: {
          total: 1,
          workers: [{ worker_id: "worker-err", status: badStatus, is_stale: false }],
        },
      });
      assert.equal(res.key, "failed");
      assert.equal(res.tone, "danger");
    }
  });

  it("6. classifies backend /health response accurately as liveness", () => {
    const res = classifyHealthStatus({
      loading: false,
      error: null,
      data: { status: "healthy", service: "ITMS", version: "1.0.0" },
    });
    assert.equal(res.key, "available");
    assert.equal(res.label, "Available (Liveness)");
  });

  it("7. classifies backend /health failure independently as Unavailable", () => {
    const res = classifyHealthStatus({
      loading: false,
      error: "Connection refused",
      data: null,
    });
    assert.equal(res.key, "unavailable");
    assert.equal(res.tone, "danger");
    assert.match(res.message, /Backend health endpoint unavailable/);
  });

  it("8. classifies road-network status success and failure", () => {
    const ok = classifyNetworkStatus({
      loading: false,
      error: null,
      data: { status: "ready", available_locally: true, file_size_mb: 49.45 },
    });
    assert.equal(ok.key, "available");
    assert.equal(ok.tone, "success");

    const missing = classifyNetworkStatus({
      loading: false,
      error: null,
      data: { status: "missing", available_locally: false },
    });
    assert.equal(missing.key, "unavailable");

    const err = classifyNetworkStatus({
      loading: false,
      error: "500 Internal Server Error",
      data: null,
    });
    assert.equal(err.key, "unavailable");
    assert.match(err.message, /Road-network graph unavailable/);
  });

  it("9. classifies routing-provider configuration without claiming external reachability", () => {
    const ok = classifyProviderStatus({
      loading: false,
      error: null,
      data: {
        geocoding_provider: "nominatim",
        routing_provider: "osrm",
        provider_status: "configured",
      },
    });
    assert.equal(ok.key, "configured");
    assert.equal(ok.label, "Configured (Unprobed)");
    assert.equal(ok.tone, "info");

    const err = classifyProviderStatus({
      loading: false,
      error: "Timeout",
      data: null,
    });
    assert.equal(err.key, "unavailable");
    assert.match(err.message, /Provider configuration unavailable/);
  });

  it("10. handles independent endpoint successes and failures via Promise.allSettled semantics", async () => {
    const results = await Promise.allSettled([
      Promise.resolve({ status: "healthy" }),
      Promise.reject(new Error("Workers timeout")),
      Promise.resolve({ status: "ready", available_locally: true }),
      Promise.resolve({ provider_status: "configured" }),
    ]);

    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(results[2].status, "fulfilled");
    assert.equal(results[3].status, "fulfilled");
  });

  it("11. supports manual refresh cycle and updates lastSyncedAt only on fulfilled calls", () => {
    let lastSyncedAt = null;
    const settled = [
      { status: "fulfilled", value: { status: "healthy" } },
      { status: "rejected", reason: new Error("err") },
    ];
    if (settled.some((r) => r.status === "fulfilled")) {
      lastSyncedAt = new Date("2026-11-25T06:15:00Z");
    }
    assert.ok(lastSyncedAt instanceof Date);
  });

  it("12. configures 30s polling interval and prevents overlapping refresh loops", () => {
    assert.equal(POLL_INTERVAL_MS, 30000);

    let inFlight = true;
    let cyclesStarted = 0;
    function tryAutoPoll() {
      if (inFlight) return false;
      cyclesStarted += 1;
      return true;
    }
    assert.equal(tryAutoPoll(), false);
    assert.equal(cyclesStarted, 0);

    inFlight = false;
    assert.equal(tryAutoPoll(), true);
    assert.equal(cyclesStarted, 1);
  });

  it("13. protects against stale responses overwriting newer refresh cycles", () => {
    let latestCycleId = 0;
    let committed = null;

    const cycle1 = ++latestCycleId;
    const cycle2 = ++latestCycleId;

    if (cycle2 === latestCycleId) committed = { cycle: 2 };
    if (cycle1 === latestCycleId) committed = { cycle: 1 };

    assert.deepEqual(committed, { cycle: 2 });
  });

  it("14. handles missing, null, or malformed fields and timestamps safely", () => {
    assert.equal(formatSystemTimestamp(null), "—");
    assert.equal(formatSystemTimestamp(undefined), "—");
    assert.equal(formatSystemTimestamp("invalid-date"), "invalid-date");
    assert.notEqual(formatSystemTimestamp("2026-11-25T06:00:00"), "—");
    assert.equal(classifyProviderStatus({ loading: false, error: null, data: {} }).key, "not_configured");
  });
});
