import { useState, useEffect, useCallback } from "react";
import {
  Users,
  UserCheck,
  UserX,
  ShieldCheck,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  UserCog,
  Power,
  FilterX,
  Bookmark,
  History,
  Info,
} from "lucide-react";
import {
  getAdminOverview,
  getAdminUsers,
  getAdminUserDetails,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "../../services/api";
import { useAuth } from "../../context/AuthContext";

function formatTimestamp(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatMetricCount(value) {
  if (value === undefined || value === null) return "Unavailable";
  return Number(value).toLocaleString();
}

export default function AdminUsers() {
  const { user: currentAdmin } = useAuth();

  // Overview metrics state
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState(null);

  // User list state
  const [usersData, setUsersData] = useState({ total: 0, limit: 10, offset: 0, users: [] });
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [usersError, setUsersError] = useState(null);

  // Search, filter & pagination state
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const limit = 10;

  // User details modal state
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState(null);

  // Confirmation modal state for mutations: { type: "role" | "status", targetUser, nextValue }
  const [pendingMutation, setPendingMutation] = useState(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState(null);

  // Success banner state
  const [successNotice, setSuccessNotice] = useState(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadOverview = useCallback(async () => {
    try {
      const data = await getAdminOverview();
      setOverview(data);
      setOverviewError(null);
    } catch (err) {
      setOverviewError(err.message || "Failed to load user metrics");
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await getAdminUsers({
        search: debouncedSearch,
        role: roleFilter,
        is_active: statusFilter,
        limit,
        offset,
      });
      setUsersData(data);
      setUsersError(null);
    } catch (err) {
      setUsersError(err.message || "Failed to load user directory");
    } finally {
      setIsLoadingUsers(false);
      setIsRefreshing(false);
    }
  }, [debouncedSearch, roleFilter, statusFilter, limit, offset]);

  // Initial overview fetch
  useEffect(() => {
    let ignore = false;
    async function initOverview() {
      try {
        const data = await getAdminOverview();
        if (!ignore) {
          setOverview(data);
          setOverviewError(null);
        }
      } catch (err) {
        if (!ignore) {
          setOverviewError(err.message || "Failed to load user metrics");
        }
      }
    }
    initOverview();
    return () => {
      ignore = true;
    };
  }, []);

  // Fetch users whenever query params change
  useEffect(() => {
    let ignore = false;
    async function fetchDirectory() {
      try {
        const data = await getAdminUsers({
          search: debouncedSearch,
          role: roleFilter,
          is_active: statusFilter,
          limit,
          offset,
        });
        if (!ignore) {
          setUsersData(data);
          setUsersError(null);
        }
      } catch (err) {
        if (!ignore) {
          setUsersError(err.message || "Failed to load user directory");
        }
      } finally {
        if (!ignore) {
          setIsLoadingUsers(false);
          setIsRefreshing(false);
        }
      }
    }
    fetchDirectory();
    return () => {
      ignore = true;
    };
  }, [debouncedSearch, roleFilter, statusFilter, limit, offset]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setUsersError(null);
    loadOverview();
    loadUsers();
  };

  const handleRoleFilterChange = (newRole) => {
    setRoleFilter(newRole);
    setOffset(0);
  };

  const handleStatusFilterChange = (newStatus) => {
    setStatusFilter(newStatus);
    setOffset(0);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setOffset(0);
  };

  const hasActiveFilters =
    searchInput.trim() !== "" || roleFilter !== "all" || statusFilter !== "all";

  // Open User Details modal
  const handleInspectUser = async (userId) => {
    setSelectedUserId(userId);
    setUserDetails(null);
    setDetailsError(null);
    setIsLoadingDetails(true);
    try {
      const details = await getAdminUserDetails(userId);
      setUserDetails(details);
    } catch (err) {
      setDetailsError(err.message || "Failed to fetch user details.");
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const closeDetailsModal = () => {
    setSelectedUserId(null);
    setUserDetails(null);
    setDetailsError(null);
  };

  // Open Confirmation Modal
  const openRoleConfirm = (targetUser) => {
    const nextRole = targetUser.role === "admin" ? "user" : "admin";
    setMutationError(null);
    setPendingMutation({
      type: "role",
      targetUser,
      nextValue: nextRole,
    });
  };

  const openStatusConfirm = (targetUser) => {
    const nextActive = targetUser.is_active === 1 ? 0 : 1;
    setMutationError(null);
    setPendingMutation({
      type: "status",
      targetUser,
      nextValue: nextActive,
    });
  };

  const closeMutationModal = () => {
    if (isMutating) return;
    setPendingMutation(null);
    setMutationError(null);
  };

  const executeMutation = async () => {
    if (!pendingMutation || isMutating) return;
    setIsMutating(true);
    setMutationError(null);
    setSuccessNotice(null);

    const { type, targetUser, nextValue } = pendingMutation;

    try {
      let updatedUser;
      if (type === "role") {
        updatedUser = await updateAdminUserRole(targetUser.id, nextValue);
      } else {
        updatedUser = await updateAdminUserStatus(targetUser.id, nextValue);
      }

      // Close modal and show clear success confirmation
      setPendingMutation(null);
      const actionLabel =
        type === "role"
          ? `Role updated to '${updatedUser.role}'`
          : `Account ${updatedUser.is_active === 1 ? "activated" : "deactivated"}`;
      setSuccessNotice(
        `${actionLabel} for ${updatedUser.full_name} (${updatedUser.email}). Active sessions for that user were revoked.`
      );

      // Refresh both user list and overview metrics
      await Promise.all([loadUsers(), loadOverview()]);

      // Refresh details modal if open for same user
      if (selectedUserId === targetUser.id) {
        const refreshedDetails = await getAdminUserDetails(targetUser.id);
        setUserDetails(refreshedDetails);
      }
    } catch (err) {
      setMutationError(err.message || "Administrative operation failed.");
    } finally {
      setIsMutating(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil((usersData.total || 0) / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const startRow = usersData.total === 0 ? 0 : offset + 1;
  const endRow = Math.min(offset + (usersData.users?.length || 0), usersData.total || 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                <Users size={20} />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                User Management
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Search, inspect, and govern registered accounts, role privileges, and active status enforcement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isLoadingUsers || isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw
                size={13}
                className={isRefreshing ? "animate-spin text-indigo-600" : "text-slate-500"}
              />
              <span>{isRefreshing ? "Refreshing..." : "Refresh Directory"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successNotice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 flex items-start gap-3"
        >
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">{successNotice}</div>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 transition cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Section A: Overview Metrics */}
      <section aria-label="User Directory Metrics">
        {overviewError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800 flex items-center justify-between gap-3">
            <span>Unable to load overview account metrics: {overviewError}</span>
            <button
              type="button"
              onClick={loadOverview}
              className="rounded-lg bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Total Users
                </span>
                <div className="rounded-lg bg-blue-50 p-2 text-blue-600 border border-blue-100">
                  <Users size={18} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold text-slate-900 tracking-tight">
                  {overview ? formatMetricCount(overview.total_users) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Active Users
                </span>
                <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600 border border-emerald-100">
                  <UserCheck size={18} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold text-emerald-700 tracking-tight">
                  {overview ? formatMetricCount(overview.active_users) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Inactive Accounts
                </span>
                <div className="rounded-lg bg-amber-50 p-2 text-amber-600 border border-amber-100">
                  <UserX size={18} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold text-amber-700 tracking-tight">
                  {overview ? formatMetricCount(overview.inactive_users) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Active Admins
                </span>
                <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 border border-indigo-100">
                  <ShieldCheck size={18} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold text-indigo-700 tracking-tight">
                  {overview ? formatMetricCount(overview.total_active_admins) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section B & C: Search, Filters & User Directory */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {/* Search & Filter Toolbar */}
        <div className="border-b border-slate-200 p-4 md:p-5 bg-slate-50/50">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by full name or email..."
                aria-label="Search users by full name or email"
                className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Role Filter */}
              <div className="flex items-center gap-1.5">
                <label htmlFor="role-filter" className="text-xs font-semibold text-slate-600">
                  Role:
                </label>
                <select
                  id="role-filter"
                  value={roleFilter}
                  onChange={(e) => handleRoleFilterChange(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">All Roles</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <label htmlFor="status-filter" className="text-xs font-semibold text-slate-600">
                  Status:
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(e) => handleStatusFilterChange(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  <FilterX size={13} />
                  <span>Clear Filters</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error State */}
        {usersError && (
          <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-3">
            <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-700">
                Directory Fetch Error
              </p>
              <p className="text-sm mt-0.5">{usersError}</p>
            </div>
            <button
              type="button"
              onClick={handleManualRefresh}
              className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoadingUsers && (
          <div className="p-5 space-y-3 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoadingUsers && !usersError && usersData.users.length === 0 && (
          <div className="p-10 text-center">
            <Users size={28} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-bold text-slate-800">
              No matching user accounts found
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              {hasActiveFilters
                ? "Try adjusting or clearing your search query, role filter, or status filter."
                : "No registered user accounts are currently present in the directory."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
              >
                <FilterX size={13} />
                <span>Clear All Filters</span>
              </button>
            )}
          </div>
        )}

        {/* Desktop & Tablet Table */}
        {!isLoadingUsers && !usersError && usersData.users.length > 0 && (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3.5">Account</th>
                    <th className="px-4 py-3.5">Role</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Registered</th>
                    <th className="px-4 py-3.5">Last Updated</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {usersData.users.map((u) => {
                    const isSelf = currentAdmin?.id === u.id;
                    const isAdmin = u.role === "admin";
                    const isActive = u.is_active === 1;

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {u.full_name}
                                {isSelf && (
                                  <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200">
                                    You
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {isAdmin ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
                              <Shield size={11} />
                              <span>Admin</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 border border-slate-200">
                              User
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              <span>Inactive</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 whitespace-nowrap">
                          {formatTimestamp(u.created_at)}
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 whitespace-nowrap">
                          {formatTimestamp(u.updated_at)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleInspectUser(u.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                              aria-label={`View details for ${u.email}`}
                            >
                              <Eye size={12} />
                              <span>Details</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openRoleConfirm(u)}
                              disabled={isMutating}
                              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition cursor-pointer"
                              aria-label={`${isAdmin ? "Demote" : "Promote"} ${u.email}`}
                            >
                              <UserCog size={12} />
                              <span>{isAdmin ? "Demote" : "Promote"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openStatusConfirm(u)}
                              disabled={isMutating}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 transition cursor-pointer ${
                                isActive
                                  ? "border-amber-200 bg-amber-50/70 text-amber-800 hover:bg-amber-100"
                                  : "border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100"
                              }`}
                              aria-label={`${isActive ? "Deactivate" : "Activate"} ${u.email}`}
                            >
                              <Power size={12} />
                              <span>{isActive ? "Deactivate" : "Activate"}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List (Zero horizontal overflow on small screens) */}
            <div className="md:hidden divide-y divide-slate-100">
              {usersData.users.map((u) => {
                const isSelf = currentAdmin?.id === u.id;
                const isAdmin = u.role === "admin";
                const isActive = u.is_active === 1;

                return (
                  <div key={u.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {u.full_name}
                          {isSelf && (
                            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              You
                            </span>
                          )}
                        </p>
                        <p className="text-xs font-mono text-slate-500 truncate">{u.email}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 border border-indigo-200">
                            <Shield size={10} />
                            <span>Admin</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 border border-slate-200">
                            User
                          </span>
                        )}
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 border border-rose-200">
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Registered: {formatTimestamp(u.created_at)}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleInspectUser(u.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        <Eye size={13} />
                        <span>Details</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openRoleConfirm(u)}
                        disabled={isMutating}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700"
                      >
                        <UserCog size={13} />
                        <span>{isAdmin ? "Demote" : "Promote"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openStatusConfirm(u)}
                        disabled={isMutating}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                          isActive
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        <Power size={13} />
                        <span>{isActive ? "Deactivate" : "Activate"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Server-Side Pagination Footer */}
            <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Showing <span className="font-semibold text-slate-900">{startRow}</span>–
                <span className="font-semibold text-slate-900">{endRow}</span> of{" "}
                <span className="font-semibold text-slate-900">{usersData.total}</span> accounts
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0 || isLoadingUsers}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>
                <span className="px-2 font-medium text-slate-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= usersData.total || isLoadingUsers}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* User Details Modal */}
      {selectedUserId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-details-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600">
                  <Eye size={18} />
                </div>
                <h2 id="user-details-title" className="text-base font-bold text-slate-900">
                  Account Details
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDetailsModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                aria-label="Close details modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6">
              {isLoadingDetails && (
                <div className="space-y-3 animate-pulse">
                  <div className="h-6 w-1/2 rounded bg-slate-200" />
                  <div className="h-20 rounded-xl bg-slate-100" />
                  <div className="h-16 rounded-xl bg-slate-100" />
                </div>
              )}

              {detailsError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                  {detailsError}
                </div>
              )}

              {userDetails && !isLoadingDetails && (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{userDetails.full_name}</h3>
                      <p className="text-sm font-mono text-slate-500">{userDetails.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          userDetails.role === "admin"
                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {userDetails.role}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          userDetails.is_active === 1
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}
                      >
                        {userDetails.is_active === 1 ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                      <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                        <Bookmark size={12} />
                        <span>Saved Routes</span>
                      </span>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {userDetails.saved_routes_count ?? 0}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                      <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                        <History size={12} />
                        <span>Route Searches</span>
                      </span>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {userDetails.route_searches_count ?? 0}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 space-y-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Account ID:</span>
                      <span className="font-mono text-slate-800 break-all">{userDetails.id}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Registered At:</span>
                      <span className="text-slate-800">{formatTimestamp(userDetails.created_at)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Last Updated:</span>
                      <span className="text-slate-800">{formatTimestamp(userDetails.updated_at)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-3.5 flex justify-end">
              <button
                type="button"
                onClick={closeDetailsModal}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mutation Confirmation Modal */}
      {pendingMutation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-mutation-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-50 p-1.5 text-amber-600">
                  <AlertTriangle size={18} />
                </div>
                <h2 id="confirm-mutation-title" className="text-base font-bold text-slate-900">
                  {pendingMutation.type === "role"
                    ? pendingMutation.nextValue === "admin"
                      ? "Confirm Admin Promotion"
                      : "Confirm Admin Demotion"
                    : pendingMutation.nextValue === 1
                    ? "Confirm Account Activation"
                    : "Confirm Account Deactivation"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeMutationModal}
                disabled={isMutating}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-40 transition cursor-pointer"
                aria-label="Close confirmation modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                {pendingMutation.type === "role" ? (
                  <>
                    Are you sure you want to change the role of{" "}
                    <span className="font-bold text-slate-900">
                      {pendingMutation.targetUser.full_name}
                    </span>{" "}
                    (<span className="font-mono text-xs">{pendingMutation.targetUser.email}</span>) from{" "}
                    <span className="font-semibold">{pendingMutation.targetUser.role}</span> to{" "}
                    <span className="font-bold text-indigo-700">{pendingMutation.nextValue}</span>?
                  </>
                ) : (
                  <>
                    Are you sure you want to{" "}
                    <span className="font-bold">
                      {pendingMutation.nextValue === 1 ? "activate" : "deactivate"}
                    </span>{" "}
                    the account for{" "}
                    <span className="font-bold text-slate-900">
                      {pendingMutation.targetUser.full_name}
                    </span>{" "}
                    (<span className="font-mono text-xs">{pendingMutation.targetUser.email}</span>)?
                  </>
                )}
              </p>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-start gap-2">
                <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
                <span>
                  This action is recorded in the immutable audit log and immediately revokes active JWT/refresh sessions for the target user.
                </span>
              </div>

              {mutationError && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800 flex items-start gap-2"
                >
                  <AlertTriangle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                  <span>{mutationError}</span>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-3.5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={closeMutationModal}
                disabled={isMutating}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeMutation}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer"
              >
                {isMutating && <RefreshCw size={13} className="animate-spin" />}
                <span>{isMutating ? "Applying..." : "Confirm Change"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
