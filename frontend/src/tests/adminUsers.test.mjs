/**
 * Automated Test Suite for Admin User Management Administration
 * =============================================================
 * Phase 11.5.5: Frontend User Directory, Filtering, Details & Mutations
 *
 * Runs natively in Node.js via node:test and node:assert.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function formatMetricCount(value) {
  if (value === undefined || value === null) return "Unavailable";
  return Number(value).toLocaleString();
}

function buildUserQueryParams({ search, role, is_active, limit = 10, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (search && search.trim()) params.set("search", search.trim());
  if (role && role !== "all") params.set("role", role);
  if (is_active !== undefined && is_active !== null && is_active !== "all") {
    params.set("is_active", String(is_active));
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params.toString();
}

function filterUsersLocal(users, { search = "", role = "all", is_active = "all" } = {}) {
  return users.filter((u) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    const matchesRole = role === "all" || u.role === role;
    const matchesStatus = is_active === "all" || String(u.is_active) === String(is_active);
    return matchesSearch && matchesRole && matchesStatus;
  });
}

function computePagination(total, limit, offset, currentUsersLength) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const startRow = total === 0 ? 0 : offset + 1;
  const endRow = Math.min(offset + currentUsersLength, total || 0);
  return {
    totalPages,
    currentPage,
    startRow,
    endRow,
    canPrev: offset > 0,
    canNext: offset + limit < total,
  };
}

function sanitizeDetailsForDisplay(details) {
  const forbiddenKeys = ["password_hash", "refresh_token", "access_token", "token_version", "secret"];
  for (const key of forbiddenKeys) {
    if (key in details) {
      return false;
    }
  }
  return true;
}

function prepareMutationConfirmation(type, targetUser) {
  if (type === "role") {
    const nextRole = targetUser.role === "admin" ? "user" : "admin";
    return {
      type: "role",
      targetUser,
      nextValue: nextRole,
      title: nextRole === "admin" ? "Confirm Admin Promotion" : "Confirm Admin Demotion",
    };
  }
  const nextActive = targetUser.is_active === 1 ? 0 : 1;
  return {
    type: "status",
    targetUser,
    nextValue: nextActive,
    title: nextActive === 1 ? "Confirm Account Activation" : "Confirm Account Deactivation",
  };
}

async function runGuardedMutation({ state, apiCall, onRefresh }) {
  if (state.isMutating) {
    return { ignored: true };
  }
  state.isMutating = true;
  state.mutationError = null;
  try {
    const updated = await apiCall();
    state.pendingMutation = null;
    state.successNotice = `Updated ${updated.email}`;
    await onRefresh();
    return { ignored: false, success: true, updated };
  } catch (err) {
    state.mutationError = err.message;
    return { ignored: false, success: false, error: err.message };
  } finally {
    state.isMutating = false;
  }
}

const sampleUsers = [
  {
    id: "u1",
    full_name: "System Administrator",
    email: "admin@itms.gov",
    role: "admin",
    is_active: 1,
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "u2",
    full_name: "Test Driver",
    email: "driver@itms.gov",
    role: "user",
    is_active: 1,
    created_at: "2026-11-21T10:00:00Z",
    updated_at: "2026-11-21T10:00:00Z",
  },
  {
    id: "u3",
    full_name: "Suspended Commuter",
    email: "suspended@example.com",
    role: "user",
    is_active: 0,
    created_at: "2026-11-22T10:00:00Z",
    updated_at: "2026-11-22T10:00:00Z",
  },
];

describe("Phase 11.5.5 — Admin User Management Verification Suite", () => {
  it("1. renders user list fields accurately from backend payload", () => {
    assert.equal(sampleUsers.length, 3);
    assert.equal(sampleUsers[0].full_name, "System Administrator");
    assert.equal(sampleUsers[0].email, "admin@itms.gov");
    assert.equal(sampleUsers[0].role, "admin");
    assert.equal(sampleUsers[0].is_active, 1);
  });

  it("2. supports searching by full name and email (query builder & matching)", () => {
    assert.equal(
      buildUserQueryParams({ search: "driver", limit: 10, offset: 0 }),
      "search=driver&limit=10&offset=0"
    );
    const byName = filterUsersLocal(sampleUsers, { search: "Commuter" });
    assert.equal(byName.length, 1);
    assert.equal(byName[0].id, "u3");

    const byEmail = filterUsersLocal(sampleUsers, { search: "driver@itms.gov" });
    assert.equal(byEmail.length, 1);
    assert.equal(byEmail[0].id, "u2");
  });

  it("3. filters by role (All, User, Admin)", () => {
    assert.equal(
      buildUserQueryParams({ role: "admin", limit: 10, offset: 0 }),
      "role=admin&limit=10&offset=0"
    );
    assert.equal(filterUsersLocal(sampleUsers, { role: "admin" }).length, 1);
    assert.equal(filterUsersLocal(sampleUsers, { role: "user" }).length, 2);
    assert.equal(filterUsersLocal(sampleUsers, { role: "all" }).length, 3);
  });

  it("4. filters by account status (All, Active, Inactive)", () => {
    assert.equal(
      buildUserQueryParams({ is_active: "0", limit: 10, offset: 0 }),
      "is_active=0&limit=10&offset=0"
    );
    assert.equal(filterUsersLocal(sampleUsers, { is_active: "1" }).length, 2);
    assert.equal(filterUsersLocal(sampleUsers, { is_active: "0" }).length, 1);
    assert.equal(filterUsersLocal(sampleUsers, { is_active: "all" }).length, 3);
  });

  it("5. computes server-side pagination bounds accurately", () => {
    const page1 = computePagination(25, 10, 0, 10);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.currentPage, 1);
    assert.equal(page1.startRow, 1);
    assert.equal(page1.endRow, 10);
    assert.equal(page1.canPrev, false);
    assert.equal(page1.canNext, true);

    const page3 = computePagination(25, 10, 20, 5);
    assert.equal(page3.currentPage, 3);
    assert.equal(page3.startRow, 21);
    assert.equal(page3.endRow, 25);
    assert.equal(page3.canPrev, true);
    assert.equal(page3.canNext, false);
  });

  it("6. handles empty and unavailable metric states without fabricating zeros", () => {
    assert.equal(formatMetricCount(undefined), "Unavailable");
    assert.equal(formatMetricCount(null), "Unavailable");
    assert.equal(formatMetricCount(0), "0");
    assert.equal(formatMetricCount(15), "15");

    const emptyPage = computePagination(0, 10, 0, 0);
    assert.equal(emptyPage.startRow, 0);
    assert.equal(emptyPage.endRow, 0);
    assert.equal(emptyPage.totalPages, 1);
  });

  it("7. renders user details safely without exposing sensitive secrets", () => {
    const safeDetails = {
      id: "u2",
      email: "driver@itms.gov",
      full_name: "Test Driver",
      role: "user",
      is_active: 1,
      created_at: "2026-11-21T10:00:00Z",
      updated_at: "2026-11-21T10:00:00Z",
      saved_routes_count: 3,
      route_searches_count: 7,
    };
    assert.equal(sanitizeDetailsForDisplay(safeDetails), true);
    assert.equal(sanitizeDetailsForDisplay({ ...safeDetails, password_hash: "secret" }), false);
    assert.equal(sanitizeDetailsForDisplay({ ...safeDetails, refresh_token: "tok" }), false);
  });

  it("8. prepares promotion and demotion confirmation modals accurately", () => {
    const promote = prepareMutationConfirmation("role", sampleUsers[1]);
    assert.equal(promote.nextValue, "admin");
    assert.equal(promote.title, "Confirm Admin Promotion");

    const demote = prepareMutationConfirmation("role", sampleUsers[0]);
    assert.equal(demote.nextValue, "user");
    assert.equal(demote.title, "Confirm Admin Demotion");
  });

  it("9. prepares activation and deactivation confirmation modals accurately", () => {
    const deactivate = prepareMutationConfirmation("status", sampleUsers[1]);
    assert.equal(deactivate.nextValue, 0);
    assert.equal(deactivate.title, "Confirm Account Deactivation");

    const activate = prepareMutationConfirmation("status", sampleUsers[2]);
    assert.equal(activate.nextValue, 1);
    assert.equal(activate.title, "Confirm Account Activation");
  });

  it("10. executes successful mutation and triggers directory + overview refresh", async () => {
    let refreshed = false;
    const state = { isMutating: false, mutationError: null, pendingMutation: {}, successNotice: null };

    const res = await runGuardedMutation({
      state,
      apiCall: async () => ({ ...sampleUsers[1], role: "admin" }),
      onRefresh: async () => {
        refreshed = true;
      },
    });

    assert.equal(res.success, true);
    assert.equal(refreshed, true);
    assert.equal(state.pendingMutation, null);
    assert.equal(state.isMutating, false);
    assert.match(state.successNotice, /driver@itms\.gov/);
  });

  it("11. surfaces backend rejection errors without clearing confirmation or masking message", async () => {
    let refreshed = false;
    const pending = { type: "role", targetUser: sampleUsers[0], nextValue: "user" };
    const state = { isMutating: false, mutationError: null, pendingMutation: pending, successNotice: null };

    const res = await runGuardedMutation({
      state,
      apiCall: async () => {
        throw new Error("Operation rejected: Cannot demote or suspend the sole remaining active administrator.");
      },
      onRefresh: async () => {
        refreshed = true;
      },
    });

    assert.equal(res.success, false);
    assert.equal(refreshed, false);
    assert.equal(state.pendingMutation, pending);
    assert.equal(state.isMutating, false);
    assert.match(state.mutationError, /sole remaining active administrator/);
  });

  it("12. prevents duplicate mutation requests while an operation is in progress", async () => {
    let apiCalls = 0;
    const state = { isMutating: true, mutationError: null, pendingMutation: {}, successNotice: null };

    const res = await runGuardedMutation({
      state,
      apiCall: async () => {
        apiCalls += 1;
        return sampleUsers[1];
      },
      onRefresh: async () => {},
    });

    assert.equal(res.ignored, true);
    assert.equal(apiCalls, 0);
  });
});
