import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePasswordChangeInput,
  validateSavedRouteTitle,
  filterSavedRoutes,
  removeHistoryEntryById,
} from "../utils/userWorkspaceUtils.js";
import * as api from "../services/api.js";

test("User Workspace — password change validation rules", () => {
  assert.equal(
    validatePasswordChangeInput({
      currentPassword: "",
      newPassword: "NewPassword123",
      confirmPassword: "NewPassword123",
    }),
    "Current password is required."
  );

  assert.equal(
    validatePasswordChangeInput({
      currentPassword: "OldPassword123",
      newPassword: "short",
      confirmPassword: "short",
    }),
    "New password must be at least 8 characters long."
  );

  assert.equal(
    validatePasswordChangeInput({
      currentPassword: "SamePassword123",
      newPassword: "SamePassword123",
      confirmPassword: "SamePassword123",
    }),
    "New password must be different from your current password."
  );

  assert.equal(
    validatePasswordChangeInput({
      currentPassword: "OldPassword123",
      newPassword: "NewPassword123",
      confirmPassword: "MismatchPassword123",
    }),
    "New password and confirmation do not match."
  );

  assert.equal(
    validatePasswordChangeInput({
      currentPassword: "OldPassword123",
      newPassword: "NewPassword123",
      confirmPassword: "NewPassword123",
    }),
    null
  );
});

test("User Workspace — saved routes title validation and filtering", () => {
  assert.deepEqual(validateSavedRouteTitle("   "), {
    valid: false,
    value: "",
    error: "Route title cannot be blank.",
  });

  assert.deepEqual(validateSavedRouteTitle("  Sector 17 Commute  "), {
    valid: true,
    value: "Sector 17 Commute",
    error: null,
  });

  const sampleRoutes = [
    {
      id: "r1",
      title: "Morning Office",
      origin_name: "Sector 17",
      destination_name: "IT Park",
      preferred_criteria: "fastest",
    },
    {
      id: "r2",
      title: "Evening Mall",
      origin_name: "Mohali Phase 7",
      destination_name: "Elante Mall",
      preferred_criteria: "balanced",
    },
  ];

  assert.equal(filterSavedRoutes(sampleRoutes, "").length, 2);
  assert.equal(filterSavedRoutes(sampleRoutes, "elante").length, 1);
  assert.equal(filterSavedRoutes(sampleRoutes, "fastest")[0].id, "r1");
});

test("User Workspace — route history deletion helper and API exports", () => {
  const history = [{ id: "h1" }, { id: "h2" }, { id: "h3" }];
  const remaining = removeHistoryEntryById(history, "h2");
  assert.deepEqual(
    remaining.map((h) => h.id),
    ["h1", "h3"]
  );

  assert.equal(typeof api.changePasswordApi, "function");
  assert.equal(typeof api.updateSavedRoute, "function");
  assert.equal(typeof api.deleteRouteHistoryEntry, "function");
});

test("User Workspace — API endpoints send expected HTTP methods and payloads", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ detail: "ok" }),
    };
  };

  try {
    await api.changePasswordApi({ current_password: "old", new_password: "newpassword123" });
    await api.updateSavedRoute("route-1", { title: "Updated Title" });
    await api.deleteRouteHistoryEntry("hist-9");

    assert.equal(calls.length, 3);
    assert.ok(calls[0].url.endsWith("/auth/password"));
    assert.equal(calls[0].options.method, "PUT");
    assert.ok(calls[1].url.endsWith("/api/v1/user/saved-routes/route-1"));
    assert.equal(calls[1].options.method, "PATCH");
    assert.ok(calls[2].url.endsWith("/api/v1/user/route-history/hist-9"));
    assert.equal(calls[2].options.method, "DELETE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
