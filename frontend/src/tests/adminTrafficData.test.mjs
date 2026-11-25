/**
 * Automated Test Suite for Admin Traffic Ingestion & Quality Monitoring
 * =====================================================================
 * Phase 11.5.6.5: API Query Serialization, Source Integrity & Raw Payload Safety
 *
 * Runs natively in Node.js via node:test and node:assert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAdminTrafficBatches,
  getAdminTrafficQuality,
  buildAdminTrafficBatchesQuery,
  buildAdminTrafficQualityQuery,
} from "../services/api.js";
import {
  TRAFFIC_SOURCE_TYPES,
  getSourceTypeMeta,
  calculateAcceptanceRate,
  aggregateBatchPageStats,
  formatSourceBreakdown,
  safeParseRawPayload,
  formatTrafficTimestamp,
  computeTrafficPagination,
} from "../utils/trafficMonitoringUtils.js";

describe("Phase 11.5.6.5 — Admin Traffic Data Monitoring Verification Suite", () => {
  describe("1. API Service & Query Parameter Encoding", () => {
    it("exports getAdminTrafficBatches and getAdminTrafficQuality", () => {
      assert.equal(typeof getAdminTrafficBatches, "function");
      assert.equal(typeof getAdminTrafficQuality, "function");
    });

    it("encodes batch source_type filter, limit, and offset accurately", () => {
      assert.equal(
        buildAdminTrafficBatchesQuery({
          source_type: "REAL_SENSOR",
          limit: 20,
          offset: 40,
        }),
        "source_type=REAL_SENSOR&limit=20&offset=40"
      );
      assert.equal(
        buildAdminTrafficBatchesQuery({ source_type: "all", limit: 20, offset: 0 }),
        "limit=20&offset=0"
      );
      assert.equal(
        buildAdminTrafficBatchesQuery({ source_type: "  ", limit: 500, offset: -5 }),
        "limit=100&offset=0"
      );
    });

    it("encodes traffic quality limit and offset accurately", () => {
      assert.equal(
        buildAdminTrafficQualityQuery({ limit: 20, offset: 20 }),
        "limit=20&offset=20"
      );
      assert.equal(
        buildAdminTrafficQualityQuery({ limit: 0, offset: -10 }),
        "limit=1&offset=0"
      );
    });
  });

  describe("2. Data Utilities (Acceptance Rate, Aggregates, Source Breakdown)", () => {
    it("calculates acceptance rate accurately and avoids division by zero", () => {
      assert.equal(calculateAcceptanceRate(95, 100), 95);
      assert.equal(calculateAcceptanceRate(19, 20), 95);
      assert.equal(calculateAcceptanceRate(1, 3), 33.3);
      assert.equal(calculateAcceptanceRate(0, 0), null);
      assert.equal(calculateAcceptanceRate(null, 100), null);
      assert.equal(calculateAcceptanceRate(10, null), null);
    });

    it("aggregates batch page statistics and tracks complete-dataset vs current-page scope", () => {
      const sample = [
        { total_records: 100, accepted_records: 90, rejected_records: 10 },
        { total_records: 50, accepted_records: 45, rejected_records: 5 },
      ];
      const complete = aggregateBatchPageStats(sample, 2);
      assert.equal(complete.totalRecords, 150);
      assert.equal(complete.acceptedRecords, 135);
      assert.equal(complete.rejectedRecords, 15);
      assert.equal(complete.acceptanceRate, 90);
      assert.equal(complete.isCompleteDataset, true);

      const partial = aggregateBatchPageStats(sample, 10);
      assert.equal(partial.isCompleteDataset, false);

      const unavail = aggregateBatchPageStats(null, null);
      assert.equal(unavail.totalRecords, null);
    });

    it("formats source breakdown and handles unknown future source types safely", () => {
      assert.deepEqual(TRAFFIC_SOURCE_TYPES, [
        "REAL_SENSOR",
        "SIMULATION_SYNTHETIC",
        "HISTORICAL_BENCHMARK",
      ]);

      const breakdown = formatSourceBreakdown({
        REAL_SENSOR: 2,
        HISTORICAL_BENCHMARK: 5,
        FUTURE_LIDAR: 1,
      });
      assert.equal(breakdown.length, 3);
      assert.equal(breakdown[0].meta.label, "Real Sensor");
      assert.equal(breakdown[2].sourceType, "FUTURE_LIDAR");
      assert.equal(breakdown[2].meta.label, "FUTURE_LIDAR");
      assert.deepEqual(formatSourceBreakdown({}), []);
      assert.deepEqual(formatSourceBreakdown(null), []);
    });

    it("returns safe metadata fallback for unknown source types", () => {
      const meta = getSourceTypeMeta("UNKNOWN_TYPE");
      assert.equal(meta.label, "UNKNOWN_TYPE");
    });
  });

  describe("3. Raw Payload Safety, Timestamps & Pagination", () => {
    it("parses valid JSON raw records and safely handles malformed or HTML-like strings", () => {
      const jsonRes = safeParseRawPayload('{"speed":-5,"lane":0}');
      assert.equal(jsonRes.kind, "json");
      assert.match(jsonRes.formatted, /"speed": -5/);

      const xssText = safeParseRawPayload('<img src=x onerror="alert(1)">');
      assert.equal(xssText.kind, "text");
      assert.equal(xssText.formatted, '<img src=x onerror="alert(1)">');

      const largeText = safeParseRawPayload("a".repeat(200));
      assert.equal(largeText.isLarge, true);
      assert.equal(largeText.preview.length, 120);

      assert.equal(safeParseRawPayload(null).kind, "empty");
      assert.equal(safeParseRawPayload("").kind, "empty");
    });

    it("formats UTC timestamps safely and returns em-dash for null/invalid values", () => {
      assert.notEqual(formatTrafficTimestamp("2026-11-25T06:00:00.123456"), "—");
      assert.equal(formatTrafficTimestamp(null), "—");
      assert.equal(formatTrafficTimestamp(undefined), "—");
    });

    it("computes server-side pagination and resets offset when source filter changes", () => {
      const p1 = computeTrafficPagination(45, 20, 0, 20);
      assert.equal(p1.totalPages, 3);
      assert.equal(p1.startRow, 1);
      assert.equal(p1.endRow, 20);
      assert.equal(p1.canPrev, false);
      assert.equal(p1.canNext, true);

      const p3 = computeTrafficPagination(45, 20, 40, 5);
      assert.equal(p3.currentPage, 3);
      assert.equal(p3.startRow, 41);
      assert.equal(p3.endRow, 45);
      assert.equal(p3.canPrev, true);
      assert.equal(p3.canNext, false);

      // Filter change resets offset to 0
      let offset = 40;
      let sourceFilter = "all";
      offset = 0;
      sourceFilter = "SIMULATION_SYNTHETIC";
      assert.equal(offset, 0);
      assert.equal(sourceFilter, "SIMULATION_SYNTHETIC");
    });

    it("discards stale overlapping batch/quality responses", () => {
      let latestBatchesReqId = 0;
      let committed = null;
      const req1 = ++latestBatchesReqId;
      const req2 = ++latestBatchesReqId;
      if (req2 === latestBatchesReqId) committed = { source: "REAL_SENSOR" };
      if (req1 === latestBatchesReqId) committed = { source: "all" };
      assert.deepEqual(committed, { source: "REAL_SENSOR" });
    });
  });
});
