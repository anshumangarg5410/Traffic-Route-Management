import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Loader2 } from "lucide-react";

/**
 * AdminRoute
 * Guard component for routes restricted exclusively to authenticated users with the 'admin' role.
 * - Unauthenticated users are redirected to /login with original location state.
 * - Authenticated non-admin users (e.g. role === 'user') are redirected to /workspace.
 * - Loading state is cleanly handled to avoid flashing unauthorized content.
 */
export default function AdminRoute({ children }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-indigo-400">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-indigo-500" size={32} />
          <p className="text-sm font-medium text-slate-400">Verifying administrator privileges...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role !== "admin") {
    return <Navigate to="/workspace" replace />;
  }

  return children;
}
