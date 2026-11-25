import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSavedRoutes, deleteSavedRoute, updateSavedRoute } from "../services/api";
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  filterSavedRoutes,
  validateSavedRouteTitle,
} from "../utils/userWorkspaceUtils";
import {
  Bookmark,
  Navigation,
  Trash2,
  Search,
  Loader2,
  AlertCircle,
  ArrowRight,
  Pencil,
  Check,
  X,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";

export default function SavedRoutes() {
  const [searchParams] = useSearchParams();
  const [routes, setRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") || "");
  const [deletingId, setDeletingId] = useState(null);
  const [routeToDelete, setRouteToDelete] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    async function loadRoutes() {
      try {
        const data = await getSavedRoutes();
        if (active) {
          setRoutes(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load saved routes.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }
    loadRoutes();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const handleRetryLoad = () => {
    setIsLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  const handleConfirmDelete = async () => {
    if (!routeToDelete) return;
    setDeletingId(routeToDelete.id);
    setError(null);
    setStatusMessage(null);
    try {
      await deleteSavedRoute(routeToDelete.id);
      setRoutes((prev) => prev.filter((r) => r.id !== routeToDelete.id));
      setStatusMessage(`Removed "${routeToDelete.title}" from saved corridors.`);
      setRouteToDelete(null);
    } catch (err) {
      setError(err.message || "Failed to delete saved route.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartRename = (route) => {
    setError(null);
    setStatusMessage(null);
    setEditingId(route.id);
    setEditingTitle(route.title || "");
  };

  const handleSaveRename = async (routeId) => {
    const check = validateSavedRouteTitle(editingTitle);
    if (!check.valid) {
      setError(check.error);
      return;
    }

    setIsSavingRename(true);
    setError(null);
    setStatusMessage(null);
    try {
      const updated = await updateSavedRoute(routeId, { title: check.value });
      setRoutes((prev) => prev.map((r) => (r.id === routeId ? updated : r)));
      setEditingId(null);
      setEditingTitle("");
      setStatusMessage(`Renamed corridor to "${updated.title}".`);
    } catch (err) {
      setError(err.message || "Failed to rename saved route.");
    } finally {
      setIsSavingRename(false);
    }
  };

  const handleOpenInPlanner = (route) => {
    navigate("/routes", {
      state: {
        sourceLocation: {
          name: route.origin_name,
          coordinates: [route.origin_lat, route.origin_lon],
        },
        destinationLocation: {
          name: route.destination_name,
          coordinates: [route.destination_lat, route.destination_lon],
        },
        title: route.title,
      },
    });
  };

  const filteredRoutes = useMemo(
    () => filterSavedRoutes(routes, searchQuery),
    [routes, searchQuery]
  );

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center text-emerald-400">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Saved Corridors</h1>
          <p className="mt-1 text-sm text-slate-400">
            Bookmarked navigation corridors with cached delay, distance, and scoring telemetry.
          </p>
        </div>

        <Link
          to="/routes"
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 self-start md:self-auto"
        >
          <Navigation size={16} />
          <span>Plan New Route</span>
        </Link>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400"
        >
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
        >
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={handleRetryLoad}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
          >
            <RefreshCw size={12} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Filter / Search Bar */}
      {routes.length > 0 && (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
            <Search size={16} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search saved corridors by title or location..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      )}

      {/* Grid of Saved Routes */}
      {filteredRoutes.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredRoutes.map((route) => (
            <div
              key={route.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg backdrop-blur transition hover:border-slate-700"
            >
              <div>
                {/* Title & Criteria Badge */}
                {editingId === route.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveRename(route.id);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      aria-label="Edit saved corridor title"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      maxLength={100}
                      autoFocus
                      className="min-w-0 flex-1 rounded-lg border border-emerald-500/50 bg-slate-950 px-2.5 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={isSavingRename}
                      aria-label="Save corridor title"
                      className="rounded-lg bg-emerald-500 p-1.5 text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {isSavingRename ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setEditingTitle("");
                      }}
                      disabled={isSavingRename}
                      aria-label="Cancel rename"
                      className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-white text-base truncate">
                      {route.title}
                    </h3>
                    <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
                      {route.preferred_criteria || "balanced"}
                    </span>
                  </div>
                )}

                {/* Waypoints */}
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex items-start gap-2 text-slate-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0 mt-1" />
                    <span className="font-medium line-clamp-1">{route.origin_name}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-300">
                    <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0 mt-1" />
                    <span className="font-medium line-clamp-1">{route.destination_name}</span>
                  </div>
                </div>

                {/* Telemetry Metrics */}
                <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-center text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Distance</span>
                    <span className="font-bold text-white">
                      {route.distance_km ? `${route.distance_km.toFixed(1)} km` : "--"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Duration</span>
                    <span className="font-bold text-white">
                      {route.estimated_duration_min ? `${route.estimated_duration_min.toFixed(0)} min` : "--"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Score</span>
                    <span className="font-bold text-emerald-400">
                      {route.route_score ? route.route_score.toFixed(0) : "--"}
                    </span>
                  </div>
                </div>

                {route.recommendation_reason && (
                  <p className="mt-3 text-[11px] text-slate-400 italic line-clamp-2">
                    "{route.recommendation_reason}"
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-4">
                <span className="text-[11px] text-slate-500">
                  {new Date(route.created_at).toLocaleDateString()}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartRename(route)}
                    disabled={deletingId === route.id}
                    aria-label={`Rename ${route.title}`}
                    title="Rename corridor"
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
                  >
                    <Pencil size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setRouteToDelete(route)}
                    disabled={deletingId === route.id}
                    aria-label={`Delete ${route.title}`}
                    title="Delete route"
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>

                  <button
                    onClick={() => handleOpenInPlanner(route)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500 hover:text-slate-950"
                  >
                    <span>Open</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 p-12 text-center">
          <div className="rounded-2xl bg-slate-800/60 p-4 text-slate-500">
            <Bookmark size={36} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-white">No saved routes found</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            {searchQuery
              ? "No saved corridors match your query. Try clearing the filter."
              : "You haven't saved any routes yet. Calculate routes in the Smart Route Planner and save them for instant access."}
          </p>
          <div className="mt-6 flex gap-3">
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
              >
                Clear Search Filter
              </button>
            ) : (
              <Link
                to="/routes"
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                <Navigation size={14} />
                <span>Open Smart Route Planner</span>
              </Link>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(routeToDelete)}
        title="Delete Saved Corridor"
        message={`Are you sure you want to remove "${routeToDelete?.title || "this corridor"}" from your saved routes?`}
        confirmLabel="Delete Corridor"
        isProcessing={Boolean(deletingId)}
        onConfirm={handleConfirmDelete}
        onCancel={() => setRouteToDelete(null)}
      />
    </div>
  );
}
