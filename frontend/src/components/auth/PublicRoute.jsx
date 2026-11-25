import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Loader2 } from "lucide-react";

export default function PublicRoute({ children }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-emerald-400">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/workspace" replace />;
  }

  return children;
}
