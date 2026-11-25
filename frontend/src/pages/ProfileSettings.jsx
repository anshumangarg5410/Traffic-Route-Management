import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  User,
  Mail,
  Shield,
  Calendar,
  LogOut,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Smartphone,
} from "lucide-react";

export default function ProfileSettings() {
  const { user, updateProfile, logout, logoutAll } = useAuth();

  const [fullName, setFullName] = useState(user?.full_name || "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Adjust form state when user profile loads or changes asynchronously
  const [prevUserFullName, setPrevUserFullName] = useState(user?.full_name || "");
  if (user?.full_name && user.full_name !== prevUserFullName) {
    setPrevUserFullName(user.full_name);
    setFullName(user.full_name);
  }

  const [isLoggingOutCurrent, setIsLoggingOutCurrent] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    if (!fullName.trim()) {
      setErrorMessage("Full name cannot be blank.");
      return;
    }

    setIsUpdating(true);
    try {
      await updateProfile(fullName);
      setSuccessMessage("Profile name updated successfully.");
    } catch (err) {
      setErrorMessage(err.message || "Failed to update profile.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogoutCurrent = async () => {
    setIsLoggingOutCurrent(true);
    try {
      await logout();
    } finally {
      setIsLoggingOutCurrent(false);
    }
  };

  const handleLogoutAll = async () => {
    if (
      !window.confirm(
        "Are you sure you want to sign out from all devices? All active mobile, web, and CLI sessions will be revoked immediately."
      )
    ) {
      return;
    }
    setIsLoggingOutAll(true);
    try {
      await logoutAll();
    } finally {
      setIsLoggingOutAll(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Profile & Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your account credentials, display profile, and active security sessions.
        </p>
      </div>

      {successMessage && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle size={18} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Account Details Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
        <h2 className="text-base font-semibold text-white">Account Identification</h2>
        <p className="mt-1 text-xs text-slate-400">
          System account metadata retrieved from the authenticated identity provider.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <User size={14} className="text-emerald-400" />
              Full Name
            </span>
            <p className="mt-1.5 text-sm font-semibold text-white truncate">
              {user?.full_name || "--"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Workspace display name</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Mail size={14} className="text-sky-400" />
              Email Address
            </span>
            <p className="mt-1.5 font-mono text-sm font-semibold text-white truncate">
              {user?.email}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Verified system login</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Shield size={14} className="text-emerald-400" />
              Assigned Role
            </span>
            <p className="mt-1.5 text-sm font-semibold text-white uppercase tracking-wider">
              {user?.role || "user"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">RBAC security tier</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Calendar size={14} className="text-purple-400" />
              Account Created
            </span>
            <p className="mt-1.5 text-sm font-semibold text-white">
              {user?.created_at ? new Date(user.created_at).toLocaleDateString() : "--"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Creation timestamp</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <User size={14} className="text-emerald-400" />
              Account Status
            </span>
            <p className="mt-1.5 text-sm font-semibold text-emerald-400">
              Active & Verified
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Zero active suspensions</p>
          </div>
        </div>
      </div>

      {/* Edit Profile Form */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
        <h2 className="text-base font-semibold text-white">Personal Information</h2>
        <p className="mt-1 text-xs text-slate-400">
          Update the display name associated with your workspace session.
        </p>

        <form onSubmit={handleUpdate} className="mt-6 max-w-lg space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Full Name
            </label>
            <div className="relative mt-1.5">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                <User size={16} />
              </div>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="block w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isUpdating}
            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {isUpdating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Session Security & Logout */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
        <h2 className="text-base font-semibold text-white">Security & Active Sessions</h2>
        <p className="mt-1 text-xs text-slate-400">
          Manage your refresh-token families and active device authorizations.
        </p>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row">
          <button
            onClick={handleLogoutCurrent}
            disabled={isLoggingOutCurrent}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
          >
            <LogOut size={16} className="text-slate-400" />
            <span>Sign Out (Current Session)</span>
          </button>

          <button
            onClick={handleLogoutAll}
            disabled={isLoggingOutAll}
            className="flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
          >
            <Smartphone size={16} />
            <span>Sign Out of All Devices</span>
          </button>
        </div>
      </div>
    </div>
  );
}
