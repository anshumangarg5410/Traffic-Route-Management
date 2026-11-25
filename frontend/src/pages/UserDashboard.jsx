import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getUserDashboardSummary, getHealthStatus } from "../services/api";
import {
  Bookmark,
  History,
  Navigation,
  ArrowRight,
  MapPin,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Cpu,
} from "lucide-react";

export default function UserDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [healthStatus, setHealthStatus] = useState("Checking...");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchDashboardData() {
      try {
        const [data, health] = await Promise.allSettled([
          getUserDashboardSummary(),
          getHealthStatus(),
        ]);

        if (isMounted) {
          if (data.status === "fulfilled") {
            setSummary(data.value);
          } else {
            setError(data.reason?.message || "Failed to load dashboard summary.");
          }

          if (health.status === "fulfilled" && health.value?.status === "healthy") {
            setHealthStatus("Healthy");
          } else {
            setHealthStatus("Degraded");
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load dashboard summary.");
          setHealthStatus("Unavailable");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    fetchDashboardData();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleReplanSearch = (searchItem) => {
    navigate("/routes", {
      state: {
        sourceQuery: searchItem.origin_query,
        destinationQuery: searchItem.destination_query,
      },
    });
  };

  const handleOpenSavedRoute = (route) => {
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

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center text-emerald-400">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-8 shadow-xl">
        <div className="relative z-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 size={12} />
                Workspace Active
              </span>
              <span className="text-xs text-slate-500 uppercase tracking-widest font-mono">
                Role: {user?.role || "user"}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
              Welcome back, {user?.full_name || "Driver"}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
              Access your personalized Smart Route Planner, explore saved corridors, and analyze Chandigarh Tricity modeled traffic intelligence.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/routes"
              className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 shadow-lg shadow-emerald-500/20"
            >
              <Navigation size={18} />
              <span>Launch Route Planner</span>
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Workspace Metric Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Saved Corridors
            </span>
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-400">
              <Bookmark size={20} />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold text-white">
            {summary?.total_saved_routes ?? 0}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">Bookmarked navigation paths</span>
            <Link to="/saved-routes" className="text-emerald-400 hover:underline">
              View all &rarr;
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Route Searches
            </span>
            <div className="rounded-lg bg-sky-500/10 p-2.5 text-sky-400">
              <History size={20} />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold text-white">
            {summary?.total_searches ?? 0}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">Total routes calculated</span>
            <Link to="/route-history" className="text-sky-400 hover:underline">
              View history &rarr;
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Backend Service
            </span>
            <div className="rounded-lg bg-purple-500/10 p-2.5 text-purple-400">
              <Cpu size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                healthStatus === "Healthy"
                  ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                  : healthStatus === "Checking..."
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-400"
              }`}
            />
            <p className="text-2xl font-bold text-white">{healthStatus}</p>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">FastAPI Service Health</span>
            <Link to="/traffic-dashboard" className="text-purple-400 hover:underline">
              System dashboard &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Main Workspace Content Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Saved Corridors Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-2.5">
              <Bookmark size={18} className="text-emerald-400" />
              <h2 className="text-base font-semibold text-white">Recent Saved Routes</h2>
            </div>
            <Link
              to="/saved-routes"
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Manage ({summary?.total_saved_routes ?? 0})
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {summary?.recent_saved_routes?.length ? (
              summary.recent_saved_routes.map((route) => (
                <div
                  key={route.id}
                  className="group flex flex-col justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4 transition hover:border-slate-700 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-white truncate text-sm">
                      {route.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 truncate">
                      <span>{route.origin_name}</span>
                      <span className="text-slate-600">&rarr;</span>
                      <span>{route.destination_name}</span>
                    </div>
                    {route.distance_km && (
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                        <span>{route.distance_km.toFixed(1)} km</span>
                        <span>&bull;</span>
                        <span>{route.estimated_duration_min?.toFixed(0)} min</span>
                        {route.route_score && (
                          <>
                            <span>&bull;</span>
                            <span className="text-emerald-400 font-medium">Score {route.route_score.toFixed(0)}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleOpenSavedRoute(route)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-500"
                  >
                    <span>Open</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-8 text-center">
                <Bookmark size={28} className="text-slate-600" />
                <p className="mt-2 text-sm font-medium text-slate-400">No saved routes yet</p>
                <p className="text-xs text-slate-500">
                  Plan a trip and click "Save Route" to bookmark your frequent commutes.
                </p>
                <Link
                  to="/routes"
                  className="mt-4 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Go to Planner
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Recent Search History Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-2.5">
              <History size={18} className="text-sky-400" />
              <h2 className="text-base font-semibold text-white">Recent Route Searches</h2>
            </div>
            <Link
              to="/route-history"
              className="text-xs font-medium text-sky-400 hover:text-sky-300"
            >
              Full History ({summary?.total_searches ?? 0})
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {summary?.recent_searches?.length ? (
              summary.recent_searches.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4 transition hover:border-slate-700 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                      <MapPin size={14} className="text-emerald-400 shrink-0" />
                      <span className="truncate">{item.origin_query}</span>
                      <span className="text-slate-600">&rarr;</span>
                      <span className="truncate">{item.destination_query}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      <Clock size={12} />
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                      {item.route_distance_km && (
                        <>
                          <span>&bull;</span>
                          <span>{item.route_distance_km.toFixed(1)} km</span>
                        </>
                      )}
                      {item.estimated_duration_min && (
                        <>
                          <span>&bull;</span>
                          <span>{item.estimated_duration_min.toFixed(0)} min</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleReplanSearch(item)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-sky-500 hover:text-slate-950 hover:border-sky-500"
                  >
                    <span>Re-plan</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-8 text-center">
                <History size={28} className="text-slate-600" />
                <p className="mt-2 text-sm font-medium text-slate-400">No search history yet</p>
                <p className="text-xs text-slate-500">
                  Searches conducted in the Smart Route Planner will automatically appear here.
                </p>
                <Link
                  to="/routes"
                  className="mt-4 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Plan a Route
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
