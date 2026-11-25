
const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : "http://127.0.0.1:8000");

// In-memory token storage (Security Invariant: access token kept in memory only; never in localStorage)
let memoryAccessToken = null;
let memoryCsrfToken = null;
let refreshPromise = null;

export const setAuthTokens = (tokens) => {
  if (tokens) {
    if (tokens.access_token !== undefined) {
      memoryAccessToken = tokens.access_token;
    }
    if (tokens.csrf_token !== undefined) {
      memoryCsrfToken = tokens.csrf_token;
    }
  } else {
    memoryAccessToken = null;
    memoryCsrfToken = null;
  }
};

export const getAuthTokens = () => ({
  access_token: memoryAccessToken,
  csrf_token: memoryCsrfToken,
});

// Helper to extract CSRF token from readable cookie fallback if memory token is not set
function getCsrfFromCookie() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)itms_csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Common function for all API requests
export async function apiRequest(endpoint, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Attach in-memory JWT bearer token if available
  if (memoryAccessToken && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${memoryAccessToken}`;
  }

  // Attach CSRF header for state-changing requests (cookie flow defense)
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfVal = memoryCsrfToken || getCsrfFromCookie();
    if (csrfVal && !headers["X-CSRF-Token"]) {
      headers["X-CSRF-Token"] = csrfVal;
    }
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: "include", // Ensure browser transmits HttpOnly cookies
  };

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, fetchOptions);
  } catch (err) {
    throw new Error(`Network connection error: ${err.message}`, { cause: err });
  }

  // Handle 401 Unauthorized with automatic silent token refresh (single retry with concurrency lock)
  if (response.status === 401 && !options._retry && endpoint !== "/auth/login" && endpoint !== "/auth/refresh") {
    options._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const csrfVal = memoryCsrfToken || getCsrfFromCookie();
          const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(csrfVal ? { "X-CSRF-Token": csrfVal } : {}),
            },
            credentials: "include",
          });

          if (!refreshRes.ok) {
            setAuthTokens(null);
            throw new Error("Session expired. Please log in again.");
          }

          const refreshData = await refreshRes.json();
          setAuthTokens({
            access_token: refreshData.access_token,
            csrf_token: refreshData.csrf_token,
          });
          return refreshData;
        })().finally(() => {
          refreshPromise = null;
        });
      }

      await refreshPromise;
      // Re-invoke with newly minted access token
      return apiRequest(endpoint, options);
    } catch {
      setAuthTokens(null);
      // Let the original error response propagate
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.detail || `API request failed: ${response.status}`
    );
  }

  return response.json();
}

// Backend health check
export const checkBackendHealth = () => {
  return apiRequest("/health");
};

// ============================================================================
// Authentication & Profile Services (Phase 11.3 & 11.4)
// ============================================================================
export const loginApi = (credentials) => {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
};

export const registerApi = (data) => {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const refreshApi = () => {
  return apiRequest("/auth/refresh", {
    method: "POST",
  });
};

export const logoutApi = () => {
  return apiRequest("/auth/logout", {
    method: "POST",
  });
};

export const logoutAllApi = () => {
  return apiRequest("/auth/logout-all", {
    method: "POST",
  });
};

export const getCurrentUserApi = () => {
  return apiRequest("/auth/me");
};

export const updateProfileApi = (data) => {
  return apiRequest("/auth/me", {
    method: "PUT",
    body: JSON.stringify(data),
  });
};

export const changePasswordApi = (data) => {
  return apiRequest("/auth/password", {
    method: "PUT",
    body: JSON.stringify(data),
  });
};

// ============================================================================
// User Workspace Services (Phase 11.4)
// ============================================================================
export const getSavedRoutes = () => {
  return apiRequest("/api/v1/user/saved-routes");
};

export const saveRoute = (data) => {
  return apiRequest("/api/v1/user/saved-routes", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const deleteSavedRoute = (routeId) => {
  return apiRequest(`/api/v1/user/saved-routes/${routeId}`, {
    method: "DELETE",
  });
};

export const getRouteHistory = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return apiRequest(`/api/v1/user/route-history${query ? `?${query}` : ""}`);
};

export const recordRouteHistory = (data) => {
  return apiRequest("/api/v1/user/route-history", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const getUserDashboardSummary = () => {
  return apiRequest("/api/v1/user/dashboard-summary");
};

export const getHealthStatus = () => {
  return apiRequest("/health");
};

// ============================================================================
// Admin Control Center API Services (Phase 11.5.2 & Phase 11.5.4)
// ============================================================================
export const getAdminOverview = () => {
  return apiRequest("/api/v1/admin/overview");
};

export const getAdminModels = () => {
  return apiRequest("/api/v1/admin/models");
};

export const buildAdminTrafficBatchesQuery = ({ source_type, limit = 20, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  if (typeof source_type === "string" && source_type.trim() && source_type !== "all") {
    params.set("source_type", source_type.trim());
  }
  const rawLimit = limit !== undefined && limit !== null ? Number(limit) : 20;
  const boundedLimit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const rawOffset = offset !== undefined && offset !== null ? Number(offset) : 0;
  const boundedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  params.set("limit", String(boundedLimit));
  params.set("offset", String(boundedOffset));
  return params.toString();
};

export const getAdminTrafficBatches = (options = {}) => {
  const query = buildAdminTrafficBatchesQuery(options);
  return apiRequest(`/api/v1/admin/traffic/batches?${query}`);
};

export const buildAdminTrafficQualityQuery = ({ limit = 20, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  const rawLimit = limit !== undefined && limit !== null ? Number(limit) : 20;
  const boundedLimit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const rawOffset = offset !== undefined && offset !== null ? Number(offset) : 0;
  const boundedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  params.set("limit", String(boundedLimit));
  params.set("offset", String(boundedOffset));
  return params.toString();
};

export const getAdminTrafficQuality = (options = {}) => {
  const query = buildAdminTrafficQualityQuery(options);
  return apiRequest(`/api/v1/admin/traffic/quality?${query}`);
};

export const buildAdminTrainingJobsQuery = ({ status, limit = 20, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  if (typeof status === "string" && status.trim() && status !== "all") {
    params.set("status", status.trim());
  }
  const rawLimit = limit !== undefined && limit !== null ? Number(limit) : 20;
  const boundedLimit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const rawOffset = offset !== undefined && offset !== null ? Number(offset) : 0;
  const boundedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  params.set("limit", String(boundedLimit));
  params.set("offset", String(boundedOffset));
  return params.toString();
};

export const getAdminTrainingJobs = (options = {}) => {
  const query = buildAdminTrainingJobsQuery(options);
  return apiRequest(`/api/v1/admin/models/jobs?${query}`);
};

export const getAdminWorkers = () => {
  return apiRequest("/api/v1/admin/system/workers");
};

export const buildAdminAuditLogsQuery = (optionsOrLimit = {}, legacyOffset = 0) => {
  const opts =
    typeof optionsOrLimit === "number"
      ? { limit: optionsOrLimit, offset: legacyOffset }
      : optionsOrLimit || {};

  const params = new URLSearchParams();
  if (typeof opts.action === "string" && opts.action.trim() && opts.action !== "all") {
    params.set("action", opts.action.trim());
  }
  if (typeof opts.actor_id === "string" && opts.actor_id.trim()) {
    params.set("actor_id", opts.actor_id.trim());
  }
  if (typeof opts.target_entity === "string" && opts.target_entity.trim()) {
    params.set("target_entity", opts.target_entity.trim());
  }
  if (typeof opts.start_date === "string" && opts.start_date.trim()) {
    params.set("start_date", opts.start_date.trim());
  }
  if (typeof opts.end_date === "string" && opts.end_date.trim()) {
    params.set("end_date", opts.end_date.trim());
  }

  const rawLimit = opts.limit !== undefined && opts.limit !== null ? Number(opts.limit) : 50;
  const boundedLimit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
  const rawOffset = opts.offset !== undefined && opts.offset !== null ? Number(opts.offset) : 0;
  const boundedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  params.set("limit", String(boundedLimit));
  params.set("offset", String(boundedOffset));
  return params.toString();
};

export const getAdminAuditLogs = (optionsOrLimit = {}, legacyOffset = 0) => {
  const query = buildAdminAuditLogsQuery(optionsOrLimit, legacyOffset);
  return apiRequest(`/api/v1/admin/audit-logs?${query}`);
};

export const getRoutingNetworkSummary = () => {
  return apiRequest("/routing/network/summary");
};

export const getRoutingNetworkStatus = () => {
  return apiRequest("/routing/network/status");
};

export const getRoutingProviderStatus = () => {
  return apiRequest("/routing/provider/status");
};

export const getAdminUsers = ({ search, role, is_active, limit = 20, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  if (search && search.trim()) params.set("search", search.trim());
  if (role && role !== "all") params.set("role", role);
  if (is_active !== undefined && is_active !== null && is_active !== "all") {
    params.set("is_active", String(is_active));
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return apiRequest(`/api/v1/admin/users?${params.toString()}`);
};

export const getAdminUserDetails = (userId) => {
  return apiRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}`);
};

export const updateAdminUserRole = (userId, role) => {
  return apiRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
};

export const updateAdminUserStatus = (userId, is_active) => {
  return apiRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
    method: "PUT",
    body: JSON.stringify({ is_active }),
  });
};

// ============================================================================
// Existing Traffic Management & Simulation Services (Preserved)
// ============================================================================
export const predictTraffic = (data) => {
  return apiRequest("/predict", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const optimizeSignal = (data) => {
  return apiRequest("/optimize-signal", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const simulateTraffic = (data) => {
  return apiRequest("/simulate", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const compareStrategies = (data) => {
  return apiRequest("/compare-strategies", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const runIntegratedPrediction = (data) => {
  return apiRequest("/integrated-prediction", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const getValidationScenarios = () => {
  return apiRequest("/validation-scenarios");
};

export const runSensitivityAnalysis = (data) => {
  return apiRequest("/sensitivity-analysis", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const executeUnifiedWorkflow = (data) => {
  return apiRequest("/unified-workflow", {
    method: "POST",
    body: JSON.stringify(data),
  });
};

// ============================================================================
// Smart Route Planner Services (Preserved)
// ============================================================================
export const geocodeLocation = (query, options = {}) => {
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return Promise.resolve(null);
  }
  return apiRequest("/routing/geocode", {
    method: "POST",
    body: JSON.stringify({ query: query.trim() }),
    ...options,
  });
};

export const getDrivingRoutes = (data, options = {}) => {
  return apiRequest("/routing/routes", {
    method: "POST",
    body: JSON.stringify({
      source: {
        latitude: Number(data.source.latitude),
        longitude: Number(data.source.longitude),
      },
      destination: {
        latitude: Number(data.destination.latitude),
        longitude: Number(data.destination.longitude),
      },
      alternatives: data.alternatives !== undefined ? Boolean(data.alternatives) : true,
      ...(data.departure_time ? { departure_time: data.departure_time } : {}),
    }),
    ...options,
  });
};
