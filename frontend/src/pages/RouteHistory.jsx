import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRouteHistory } from "../services/api";
import {
  History,
  MapPin,
  Navigation,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

export default function RouteHistory() {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await getRouteHistory({ limit: 50 });
        setHistory(data);
      } catch (err) {
        setError(err.message || "Failed to load route history.");
      } finally {
        setIsLoading(false);
      }
    }
    loadHistory();
  }, []);

  const handleReplan = (item) => {
    navigate("/routes", {
      state: {
        sourceQuery: item.origin_query,
        destinationQuery: item.destination_query,
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Route Search History</h1>
          <p className="mt-1 text-sm text-slate-400">
            Audit trail of driving route queries and corridor evaluations executed by your account.
          </p>
        </div>

        <Link
          to="/routes"
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 self-start md:self-auto"
        >
          <Navigation size={16} />
          <span>New Route Search</span>
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* History Table / List */}
      {history.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="px-6 py-4">Timestamp</th>
                  <th scope="col" className="px-6 py-4">Origin Point</th>
                  <th scope="col" className="px-6 py-4">Destination Point</th>
                  <th scope="col" className="px-6 py-4">Distance</th>
                  <th scope="col" className="px-6 py-4">Est. Duration</th>
                  <th scope="col" className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {history.map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-800/30">
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-400">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-medium text-white max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-emerald-400 shrink-0" />
                        <span className="truncate">{item.origin_query}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-white max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-sky-400 shrink-0" />
                        <span className="truncate">{item.destination_query}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-slate-300">
                      {item.route_distance_km ? `${item.route_distance_km.toFixed(1)} km` : "--"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-slate-300">
                      {item.estimated_duration_min ? `${item.estimated_duration_min.toFixed(0)} min` : "--"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <button
                        onClick={() => handleReplan(item)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-500"
                      >
                        <RefreshCw size={12} />
                        <span>Re-evaluate</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 p-12 text-center">
          <div className="rounded-2xl bg-slate-800/60 p-4 text-slate-500">
            <History size={36} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-white">No route searches recorded</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            Every route evaluation performed in the Smart Route Planner is automatically logged here.
          </p>
          <Link
            to="/routes"
            className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
          >
            <Navigation size={14} />
            <span>Plan a Route Now</span>
          </Link>
        </div>
      )}
    </div>
  );
}
