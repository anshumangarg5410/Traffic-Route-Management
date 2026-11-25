import { useState, useRef, useEffect } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import {
  Menu,
  ChevronDown,
  Shield,
  ArrowLeft,
  LogOut,
  User,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const adminPageTitles = {
  "/admin": {
    title: "Platform Overview",
    subtitle: "Real-time system health, operational status, and active models",
  },
  "/admin/users": {
    title: "User Management",
    subtitle: "Manage accounts, promote administrators, and review permissions",
  },
  "/admin/traffic-data": {
    title: "Traffic Ingestion & Quality",
    subtitle: "Ingestion batch logs, validation rejections, and feed telemetry",
  },
  "/admin/models": {
    title: "ML Model Governance",
    subtitle: "Model registry catalog, artifact verification, and deployment pointers",
  },
  "/admin/system": {
    title: "System & Worker Status",
    subtitle: "Distributed background workers, process telemetry, and lease status",
  },
  "/admin/audit-logs": {
    title: "Administrative Audit Trail",
    subtitle: "Immutable record of administrative mutations and security actions",
  },
};

export default function AdminHeader({ onToggleSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const currentMeta = adminPageTitles[location.pathname] || {
    title: "Admin Control Center",
    subtitle: "Intelligent Traffic Management System Operations",
  };

  const today = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSignOut = async () => {
    setIsDropdownOpen(false);
    await logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-4 md:px-8 backdrop-blur shadow-xs">
      {/* Left: Mobile hamburger toggle & page heading */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-xl border border-slate-200 bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition lg:hidden"
          aria-label="Toggle admin navigation"
        >
          <Menu size={20} />
        </button>

        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
              {currentMeta.title}
            </h2>
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
              <Shield size={11} className="text-indigo-600" />
              <span>Admin</span>
            </span>
          </div>
          <p className="hidden sm:block text-xs text-slate-500">
            {currentMeta.subtitle}
          </p>
        </div>
      </div>

      {/* Right: Operational Status, Workspace Switcher & Admin Profile */}
      <div className="flex items-center gap-3 md:gap-4">
        {/* Quick link back to User Workspace */}
        <Link
          to="/workspace"
          className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-700 hover:border-emerald-300 transition shadow-2xs"
          title="Switch to driver/user workspace view"
        >
          <ArrowLeft size={14} />
          <span>User Workspace</span>
        </Link>

        {/* Neutral operations badge */}
        <div className="hidden lg:flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
          <Shield size={13} className="text-indigo-600" />
          <span>ADMIN CONTROL CENTER</span>
        </div>

        {/* Admin Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-2 pr-3 text-left transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none shadow-2xs"
            aria-expanded={isDropdownOpen}
            aria-haspopup="true"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow-2xs">
              {user?.full_name ? user.full_name[0].toUpperCase() : "A"}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-slate-900 truncate max-w-[130px]">
                {user?.full_name || "Administrator"}
              </p>
              <p className="text-[10px] text-indigo-600 font-medium">
                Admin Role
              </p>
            </div>
            <ChevronDown size={14} className="text-slate-400 transition" />
          </button>

          {/* Profile Menu Dropdown */}
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl animate-in fade-in zoom-in-95 duration-150 z-50">
              <div className="border-b border-slate-100 px-3 py-2.5">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {user?.full_name || "Administrator"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {user?.email}
                </p>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 border border-indigo-200">
                    <Shield size={10} />
                    <span>Administrator</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{today}</span>
                </div>
              </div>

              <div className="py-1">
                <Link
                  to="/workspace"
                  onClick={() => setIsDropdownOpen(false)}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-emerald-700 transition"
                >
                  <User size={14} className="text-emerald-600" />
                  <span>Switch to User Workspace</span>
                </Link>
                <Link
                  to="/profile"
                  onClick={() => setIsDropdownOpen(false)}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-700 transition"
                >
                  <Shield size={14} className="text-indigo-600" />
                  <span>Account Security</span>
                </Link>
              </div>

              <div className="border-t border-slate-100 pt-1">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition"
                >
                  <LogOut size={14} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
