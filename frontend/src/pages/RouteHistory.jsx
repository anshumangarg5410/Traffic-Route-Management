import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRouteHistory, deleteRouteHistoryEntry } from "../services/api";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { removeHistoryEntryById } from "../utils/userWorkspaceUtils";
import {
  History,
  MapPin,
  Navigation,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  CheckCircle2,
} from "lucide-react";

export default function RouteHistory() {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    async function loadHistory() {
      try {
        const data = await getRouteHistory({ limit: 50 });
        if (active) {
          setHistory(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load route history.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }
    loadHistory();
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
    if (!entryToDelete) return;
    setDeletingId(entryToDelete.id);
    setError(null);
    setStatusMessage(null);
    try {
      await deleteRouteHistoryEntry(entryToDelete.id);
      setHistory((prev) => removeHistoryEntryById(prev, entryToDelete.id));
      setStatusMessage("Search history entry removed.");
      setEntryToDelete(null);
    } catch (err) {
      setError(err.message || "Failed to delete route history entry.");
    } finally {
      setDeletingId(null);
    }
  };

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
      <div className="flex h-96 items-center justify-center text-emerald-600">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Route Search History</h1>
          <p className="mt-1 text-sm text-slate-600">
            Audit trail of driving route queries and corridor evaluations executed by your account.
          </p>
        </div>

        <Link
          to="/routes"
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400 self-start md:self-auto"
        >
          <Navigation size={16} />
          <span>New Route Search</span>
        </Link>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-600"
        >
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600"
        >
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={handleRetryLoad}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-500/20"
          >
            <RefreshCw size={12} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* History Table / List */}
      {history.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white backdrop-blur shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th scope="col" className="px-6 py-4">Timestamp</th>
                  <th scope="col" className="px-6 py-4">Origin Point</th>
                  <th scope="col" className="px-6 py-4">Destination Point</th>
                  <th scope="col" className="px-6 py-4">Distance</th>
                  <th scope="col" className="px-6 py-4">Est. Duration</th>
                  <th scope="col" className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {history.map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-100">
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-600">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900 max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-emerald-600 shrink-0" />
                        <span className="truncate">{item.origin_query}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900 max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-sky-600 shrink-0" />
                        <span className="truncate">{item.destination_query}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-slate-700">
                      {item.route_distance_km ? `${item.route_distance_km.toFixed(1)} km` : "--"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-slate-700">
                      {item.estimated_duration_min ? `${item.estimated_duration_min.toFixed(0)} min` : "--"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReplan(item)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-emerald-600 hover:text-slate-900 hover:border-emerald-500"
                        >
                          <RefreshCw size={12} />
                          <span>Re-evaluate</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryToDelete(item)}
                          disabled={deletingId === item.id}
                          aria-label={`Delete history entry from ${item.origin_query} to ${item.destination_query}`}
                          title="Delete history entry"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
                        >
                          {deletingId === item.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <div className="rounded-2xl bg-slate-100 p-4 text-slate-500">
            <History size={36} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">No route searches recorded</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-600">
            Every route evaluation performed in the Smart Route Planner is automatically logged here.
          </p>
          <Link
            to="/routes"
            className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-400"
          >
            <Navigation size={14} />
            <span>Plan a Route Now</span>
          </Link>
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(entryToDelete)}
        title="Delete History Entry"
        message={`Remove the route search from "${entryToDelete?.origin_query || ""}" to "${entryToDelete?.destination_query || ""}" from your history?`}
        confirmLabel="Delete Entry"
        isProcessing={Boolean(deletingId)}
        onConfirm={handleConfirmDelete}
        onCancel={() => setEntryToDelete(null)}
      />
    </div>
  );
}
