import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSavedRoutes, deleteSavedRoute } from "../services/api";
import {
  Bookmark,
  Navigation,
  Trash2,
  Search,
  Loader2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

export default function SavedRoutes() {
  const [routes, setRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    async function loadRoutes() {
      try {
        const data = await getSavedRoutes();
        setRoutes(data);
      } catch (err) {
        setError(err.message || "Failed to load saved routes.");
      } finally {
        setIsLoading(false);
      }
    }
    loadRoutes();
  }, []);

  const handleDelete = async (routeId) => {
    if (!window.confirm("Are you sure you want to remove this saved corridor?")) {
      return;
    }
    setDeletingId(routeId);
    try {
      await deleteSavedRoute(routeId);
      setRoutes((prev) => prev.filter((r) => r.id !== routeId));
    } catch (err) {
      alert(err.message || "Failed to delete saved route.");
    } finally {
      setDeletingId(null);
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

  const filteredRoutes = useMemo(() => {
    if (!searchQuery.trim()) return routes;
    const q = searchQuery.toLowerCase();
    return routes.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.origin_name?.toLowerCase().includes(q) ||
        r.destination_name?.toLowerCase().includes(q) ||
        r.preferred_criteria?.toLowerCase().includes(q)
    );
  }, [routes, searchQuery]);

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

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
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
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-white text-base truncate">
                    {route.title}
                  </h3>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
                    {route.preferred_criteria || "balanced"}
                  </span>
                </div>

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
                    onClick={() => handleDelete(route.id)}
                    disabled={deletingId === route.id}
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
    </div>
  );
}
