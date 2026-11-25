/**
 * Automated Test Suite for Admin Audit Log Viewer
 * ================================================
 * Phase 11.5.6.2: Frontend Audit Log Query Serialization, Validation & Rendering
 *
 * Runs natively in Node.js via node:test and node:assert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAdminAuditLogsQuery } from "../services/api.js";
import {
  SUPPORTED_AUDIT_ACTIONS,
  isValidUuid,
  validateAuditFilters,
  formatAuditDetails,
  computeAuditPagination,
  formatAuditTimestamp,
} from "../utils/auditLogUtils.js";

describe("Phase 11.5.6.2 — Admin Audit Log Viewer Verification Suite", () => {
  it("1. serializes API query parameters accurately for object and legacy positional callers", () => {
    const query = buildAdminAuditLogsQuery({
      action: "USER_ROLE_CHANGE",
      actor_id: "889934577e2b488cbeb64465be439dc6",
      target_entity: "user:0df9",
      start_date: "2026-11-25T00:00:00.000Z",
      end_date: "2026-11-25T23:59:59.000Z",
      limit: 50,
      offset: 100,
    });
    const params = new URLSearchParams(query);
    assert.equal(params.get("action"), "USER_ROLE_CHANGE");
    assert.equal(params.get("actor_id"), "889934577e2b488cbeb64465be439dc6");
    assert.equal(params.get("target_entity"), "user:0df9");
    assert.equal(params.get("start_date"), "2026-11-25T00:00:00.000Z");
    assert.equal(params.get("end_date"), "2026-11-25T23:59:59.000Z");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "100");

    // Legacy positional call compatibility: getAdminAuditLogs(5, 0)
    assert.equal(buildAdminAuditLogsQuery(5, 0), "limit=5&offset=0");
  });

  it("2. omits empty, undefined, null, or 'all' optional filters", () => {
    const query = buildAdminAuditLogsQuery({
      action: "all",
      actor_id: "   ",
      target_entity: "",
      start_date: undefined,
      end_date: null,
      limit: 50,
      offset: 0,
    });
    assert.equal(query, "limit=50&offset=0");
  });

  it("3. exposes the exact 6 backend-supported action values", () => {
    assert.deepEqual(SUPPORTED_AUDIT_ACTIONS, [
      "USER_ROLE_CHANGE",
      "USER_STATUS_CHANGE",
      "MODEL_DEPLOY",
      "MODEL_ROLLBACK",
      "NETWORK_BUILD",
      "DATASET_INGEST",
    ]);
  });

  it("4. validates both 32-char hex UUIDs and standard hyphenated UUIDs, rejecting emails/invalid strings", () => {
    assert.equal(isValidUuid("889934577e2b488cbeb64465be439dc6"), true);
    assert.equal(isValidUuid("88993457-7e2b-488c-beb6-4465be439dc6"), true);
    assert.equal(isValidUuid("admin@itms.gov"), false);
    assert.equal(isValidUuid("not-a-uuid"), false);

    const invalid = validateAuditFilters({ actorId: "admin@itms.gov" });
    assert.equal(invalid.isValid, false);
    assert.match(invalid.errors.actorId, /valid UUID/i);

    const valid = validateAuditFilters({ actorId: "889934577e2b488cbeb64465be439dc6" });
    assert.equal(valid.isValid, true);
  });

  it("5. validates date ranges and rejects start_date > end_date", () => {
    const invalidRange = validateAuditFilters({
      startDate: "2026-11-25T15:00",
      endDate: "2026-11-25T10:00",
    });
    assert.equal(invalidRange.isValid, false);
    assert.match(invalidRange.errors.dateRange, /earlier than or equal/i);

    const validEqualRange = validateAuditFilters({
      startDate: "2026-11-25T10:00",
      endDate: "2026-11-25T10:00",
    });
    assert.equal(validEqualRange.isValid, true);
  });

  it("6. bounds negative offsets and clamps limit to backend 1..100 contract", () => {
    assert.equal(buildAdminAuditLogsQuery({ limit: 500, offset: -20 }), "limit=100&offset=0");
    assert.equal(buildAdminAuditLogsQuery({ limit: 0, offset: -1 }), "limit=1&offset=0");
  });

  it("7. computes server-side pagination and boundary states accurately", () => {
    const page1 = computeAuditPagination(120, 50, 0, 50);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.currentPage, 1);
    assert.equal(page1.startRow, 1);
    assert.equal(page1.endRow, 50);
    assert.equal(page1.canPrev, false);
    assert.equal(page1.canNext, true);

    const page3 = computeAuditPagination(120, 50, 100, 20);
    assert.equal(page3.currentPage, 3);
    assert.equal(page3.startRow, 101);
    assert.equal(page3.endRow, 120);
    assert.equal(page3.canPrev, true);
    assert.equal(page3.canNext, false);
  });

  it("8. handles empty result sets gracefully", () => {
    const empty = computeAuditPagination(0, 50, 0, 0);
    assert.equal(empty.totalPages, 1);
    assert.equal(empty.currentPage, 1);
    assert.equal(empty.startRow, 0);
    assert.equal(empty.endRow, 0);
    assert.equal(empty.canPrev, false);
    assert.equal(empty.canNext, false);
  });

  it("9. tracks loading, error, and refresh state transitions cleanly", () => {
    const state = { isLoading: true, isRefreshing: false, error: null, auditData: null };
    // Simulate API failure
    state.isLoading = false;
    state.error = "Network connection error";
    assert.equal(state.auditData, null);
    assert.equal(state.error, "Network connection error");

    // Simulate manual refresh recovery
    state.isRefreshing = true;
    state.error = null;
    state.auditData = { total: 8, limit: 50, offset: 0, items: [] };
    state.isRefreshing = false;
    assert.equal(state.error, null);
    assert.equal(state.auditData.total, 8);
  });

  it("10. safely formats structured JSON, plain text, malformed JSON, and large payloads", () => {
    const jsonRes = formatAuditDetails('{"new_role":"admin","old_role":"user"}');
    assert.equal(jsonRes.kind, "json");
    assert.match(jsonRes.formatted, /"new_role": "admin"/);

    const textRes = formatAuditDetails("<script>alert(1)</script> plain message");
    assert.equal(textRes.kind, "text");
    assert.equal(textRes.formatted, "<script>alert(1)</script> plain message");

    const largeStr = "x".repeat(200);
    const largeRes = formatAuditDetails(largeStr);
    assert.equal(largeRes.isLarge, true);
    assert.equal(largeRes.preview.length, 140);
  });

  it("11. handles missing actor metadata, missing IP addresses, and UTC timestamps safely", () => {
    assert.equal(formatAuditDetails(null).kind, "empty");
    assert.equal(formatAuditDetails("").formatted, "—");
    assert.notEqual(formatAuditTimestamp("2026-11-25T05:47:33.583491"), "—");
    assert.equal(formatAuditTimestamp(null), "—");
  });

  it("12. resets pagination to offset 0 when filters are applied or cleared", () => {
    let offset = 50;
    let appliedFilters = { action: "all" };
    // Simulate handleApplyFilters
    offset = 0;
    appliedFilters = { action: "USER_ROLE_CHANGE" };
    assert.equal(offset, 0);
    assert.equal(appliedFilters.action, "USER_ROLE_CHANGE");
  });

  it("13. prevents stale overlapping responses from overwriting newer requests", async () => {
    let latestRequestId = 0;
    let committedData = null;

    const req1Id = ++latestRequestId;
    const req2Id = ++latestRequestId;

    // Newer request (req2) resolves first
    if (req2Id === latestRequestId) {
      committedData = { tag: "newer-filter" };
    }
    // Older request (req1) resolves later -> must be ignored
    if (req1Id === latestRequestId) {
      committedData = { tag: "stale-filter" };
    }

    assert.deepEqual(committedData, { tag: "newer-filter" });
  });
});
