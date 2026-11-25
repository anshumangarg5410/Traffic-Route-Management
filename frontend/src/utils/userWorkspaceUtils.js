/**
 * User Workspace Helpers
 * Pure validation and list-state utilities for ProfileSettings, SavedRoutes, and RouteHistory.
 */

export function validatePasswordChangeInput({ currentPassword, newPassword, confirmPassword }) {
  if (!currentPassword) {
    return "Current password is required.";
  }
  if (!newPassword || newPassword.length < 8) {
    return "New password must be at least 8 characters long.";
  }
  if (newPassword === currentPassword) {
    return "New password must be different from your current password.";
  }
  if (newPassword !== confirmPassword) {
    return "New password and confirmation do not match.";
  }
  return null;
}

export function validateSavedRouteTitle(title) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) {
    return { valid: false, value: "", error: "Route title cannot be blank." };
  }
  if (trimmed.length > 100) {
    return { valid: false, value: trimmed, error: "Route title must be 100 characters or fewer." };
  }
  return { valid: true, value: trimmed, error: null };
}

export function filterSavedRoutes(routes, searchQuery) {
  if (!Array.isArray(routes)) return [];
  const q = String(searchQuery ?? "").trim().toLowerCase();
  if (!q) return routes;
  return routes.filter(
    (r) =>
      r.title?.toLowerCase().includes(q) ||
      r.origin_name?.toLowerCase().includes(q) ||
      r.destination_name?.toLowerCase().includes(q) ||
      r.preferred_criteria?.toLowerCase().includes(q)
  );
}

export function removeHistoryEntryById(history, entryId) {
  if (!Array.isArray(history)) return [];
  return history.filter((item) => item.id !== entryId);
}
