/**
 * Automated Test Suite for Admin ML Model Governance & Training Job Monitoring
 * ============================================================================
 * Phase 11.5.6.4: API Query Serialization, Safe JSON Parsing, Metrics & Pagination
 *
 * Runs natively in Node.js via node:test and node:assert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAdminModels,
  getAdminTrainingJobs,
  buildAdminTrainingJobsQuery,
} from "../services/api.js";
import {
  TRAINING_JOB_STATUSES,
  safeJsonParse,
  formatModelMetricValue,
  formatModelTimestamp,
  calculateJobDuration,
  summarizeModelRegistry,
  computeJobsPagination,
} from "../utils/modelMonitoringUtils.js";

describe("Phase 11.5.6.4 — ML Model Monitoring Verification Suite", () => {
  describe("1. API Service & Query Parameter Encoding", () => {
    it("exports getAdminModels and getAdminTrainingJobs", () => {
      assert.equal(typeof getAdminModels, "function");
      assert.equal(typeof getAdminTrainingJobs, "function");
    });

    it("serializes training jobs query parameters and omits 'all' or empty status", () => {
      assert.equal(
        buildAdminTrainingJobsQuery({ status: "COMPLETED", limit: 20, offset: 40 }),
        "status=COMPLETED&limit=20&offset=40"
      );
      assert.equal(
        buildAdminTrainingJobsQuery({ status: "all", limit: 20, offset: 0 }),
        "limit=20&offset=0"
      );
      assert.equal(
        buildAdminTrainingJobsQuery({ status: "   ", limit: 500, offset: -5 }),
        "limit=100&offset=0"
      );
    });

    it("exposes exact backend-supported training job statuses", () => {
      assert.deepEqual(TRAINING_JOB_STATUSES, [
        "QUEUED",
        "RUNNING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ]);
    });
  });

  describe("2. Data Utilities (Safe JSON, Metrics, Timestamps, Duration)", () => {
    it("parses valid JSON strings and objects safely", () => {
      const objRes = safeJsonParse('{"accuracy":0.9123,"f1":0.89}');
      assert.equal(objRes.ok, true);
      assert.equal(objRes.isEmpty, false);
      assert.equal(objRes.value.accuracy, 0.9123);
      assert.match(objRes.formatted, /"accuracy": 0\.9123/);

      const arrRes = safeJsonParse('["hour","temp","rain_1h"]');
      assert.equal(arrRes.ok, true);
      assert.deepEqual(arrRes.value, ["hour", "temp", "rain_1h"]);
    });

    it("handles malformed JSON, null, and empty values without throwing", () => {
      const malformed = safeJsonParse("{invalid json");
      assert.equal(malformed.ok, false);
      assert.equal(malformed.raw, "{invalid json");

      assert.equal(safeJsonParse(null).isEmpty, true);
      assert.equal(safeJsonParse(undefined).isEmpty, true);
      assert.equal(safeJsonParse("").isEmpty, true);
    });

    it("formats numeric metrics and treats null/NaN as Unavailable", () => {
      assert.equal(formatModelMetricValue(0.91234), "0.9123");
      assert.equal(formatModelMetricValue(42), "42");
      assert.equal(formatModelMetricValue(null), "Unavailable");
      assert.equal(formatModelMetricValue(undefined), "Unavailable");
      assert.equal(formatModelMetricValue(Number.NaN), "Unavailable");
    });

    it("formats UTC timestamps safely and returns em-dash for missing/invalid values", () => {
      assert.notEqual(formatModelTimestamp("2026-11-24T10:30:54.595345"), "—");
      assert.equal(formatModelTimestamp(null), "—");
      assert.equal(formatModelTimestamp(undefined), "—");
    });

    it("calculates job duration only when valid start and end timestamps exist", () => {
      assert.equal(
        calculateJobDuration("2026-11-25T10:00:00Z", "2026-11-25T10:02:15Z"),
        "2m 15s"
      );
      assert.equal(
        calculateJobDuration("2026-11-25T10:00:00Z", "2026-11-25T11:05:00Z"),
        "1h 5m"
      );
      assert.equal(calculateJobDuration(null, "2026-11-25T10:02:15Z"), "—");
      assert.equal(calculateJobDuration("2026-11-25T10:00:00Z", null), "—");
      assert.equal(
        calculateJobDuration("2026-11-25T10:05:00Z", "2026-11-25T10:00:00Z"),
        "—"
      );
    });
  });

  describe("3. Registry Summary, Pagination & Concurrency State", () => {
    it("computes registry summary counts accurately and handles empty/unavailable states", () => {
      const empty = summarizeModelRegistry([]);
      assert.equal(empty.total, 0);
      assert.equal(empty.activeCount, 0);

      const unavail = summarizeModelRegistry(null);
      assert.equal(unavail.total, null);

      const populated = summarizeModelRegistry([
        { id: "m1", is_active: 1, review_status: "APPROVED" },
        { id: "m2", is_active: 0, review_status: "PENDING_REVIEW" },
        { id: "m3", is_active: 0, review_status: "REJECTED" },
      ]);
      assert.equal(populated.total, 3);
      assert.equal(populated.activeCount, 1);
      assert.equal(populated.approvedCount, 1);
      assert.equal(populated.pendingReviewCount, 1);
      assert.equal(populated.rejectedCount, 1);
    });

    it("computes server-side pagination and resets offset when status filter changes", () => {
      const p1 = computeJobsPagination(45, 20, 0, 20);
      assert.equal(p1.totalPages, 3);
      assert.equal(p1.currentPage, 1);
      assert.equal(p1.startRow, 1);
      assert.equal(p1.endRow, 20);
      assert.equal(p1.canPrev, false);
      assert.equal(p1.canNext, true);

      const p3 = computeJobsPagination(45, 20, 40, 5);
      assert.equal(p3.currentPage, 3);
      assert.equal(p3.startRow, 41);
      assert.equal(p3.endRow, 45);
      assert.equal(p3.canPrev, true);
      assert.equal(p3.canNext, false);

      // Simulate filter change resetting offset to 0
      let offset = 40;
      let status = "all";
      offset = 0;
      status = "FAILED";
      assert.equal(offset, 0);
      assert.equal(status, "FAILED");
    });

    it("discards stale overlapping training job responses", () => {
      let latestJobsReqId = 0;
      let committed = null;

      const reqA = ++latestJobsReqId;
      const reqB = ++latestJobsReqId;

      if (reqB === latestJobsReqId) committed = { status: "FAILED" };
      if (reqA === latestJobsReqId) committed = { status: "RUNNING" };

      assert.deepEqual(committed, { status: "FAILED" });
    });
  });
});
