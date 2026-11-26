import { useState, useRef, useEffect } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import {
  Bell,
  Search,
  Menu,
  ChevronDown,
  User,
  Bookmark,
  History,
  LogOut,
  Shield,
  LogIn,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getHealthStatus } from "../../services/api";

const pageTitles = {
  "/": "User Workspace Overview",
  "/traffic-dashboard": "Traffic System Overview",
  "/routes": "Smart Route Planner",
  "/route-planner": "Smart Route Planner",
  "/saved-routes": "Saved Corridors",
  "/route-history": "Route Search History",
  "/profile": "Profile & Settings",
  "/prediction": "Traffic Prediction",
  "/optimization": "Signal Optimization",
  "/simulation": "Traffic Simulation",
  "/comparison": "Strategy Comparison",
  "/validation": "Validation & Sensitivity Analysis",
  "/ml-lab": "Machine Learning Laboratory",
  "/login": "Sign In",
  "/register": "Create Account",
};

export default function Header({ onToggleSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [healthInfo, setHealthInfo] = useState(null);
  const [corridorQuery, setCorridorQuery] = useState("");
  const dropdownRef = useRef(null);
  const statusRef = useRef(null);

  const title = pageTitles[location.pathname] || "Traffic Management";

  const today = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(event.target)) {
        setIsStatusOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
        setIsStatusOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleSearchCorridors = (e) => {
    e.preventDefault();
    const q = corridorQuery.trim();
    navigate(q ? `/saved-routes?q=${encodeURIComponent(q)}` : "/saved-routes");
  };

  const handleToggleStatus = async () => {
    const next = !isStatusOpen;
    setIsStatusOpen(next);
    if (next) {
      try {
        const res = await getHealthStatus();
        setHealthInfo({ ok: res?.status === "healthy", detail: res?.service || "API online" });
      } catch {
        setHealthInfo({ ok: false, detail: "Unable to reach backend health endpoint" });
      }
    }
  };

  const handleSignOut = async () => {
    setIsDropdownOpen(false);
    await logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-4 md:px-8 backdrop-blur">
      {/* Left: Mobile hamburger toggle & page heading */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition lg:hidden"
          aria-label="Toggle navigation menu"
        >
          <Menu size={20} />
        </button>

        <div>
          <h2 className="text-lg md:text-xl font-semibold text-slate-900 tracking-tight">
            {title}
          </h2>
          <p className="hidden sm:block mt-0.5 text-xs text-slate-500">
            Intelligent Traffic Management System • Tricity
          </p>
        </div>
      </div>

      {/* Right: Search, System Status & User Profile */}
      <div className="flex items-center gap-3 md:gap-4">
        <form
          onSubmit={handleSearchCorridors}
          role="search"
          aria-label="Search saved corridors"
          className="hidden lg:flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-700 focus-within:border-emerald-500/60"
        >
          <Search size={15} className="text-slate-500 shrink-0" />
          <input
            type="search"
            value={corridorQuery}
            onChange={(e) => setCorridorQuery(e.target.value)}
            placeholder="Search saved corridors..."
            aria-label="Search saved corridors"
            className="w-40 bg-transparent text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
          />
        </form>

        <div className="relative" ref={statusRef}>
          <button
            type="button"
            onClick={handleToggleStatus}
            aria-expanded={isStatusOpen}
            aria-haspopup="true"
            className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            aria-label="Check system status"
          >
            <Bell size={17} />
          </button>

          {isStatusOpen && (
            <div
              role="status"
              className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xl"
            >
              <p className="text-xs font-semibold text-slate-900">System Status</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                {healthInfo?.ok ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle size={15} className="text-amber-600 shrink-0" />
                )}
                <span>{healthInfo ? healthInfo.detail : "Checking backend health..."}</span>
              </div>
            </div>
          )}
        </div>

        {/* User Auth Section */}
        {isAuthenticated && user ? (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-2 pr-3 text-left transition hover:border-slate-300 hover:bg-white focus:outline-none"
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-xs font-bold text-emerald-600">
                {user.full_name ? user.full_name[0].toUpperCase() : user.email[0].toUpperCase()}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-semibold text-slate-900 truncate max-w-[120px]">
                  {user.full_name || "User"}
                </p>
                <p className="text-[10px] text-slate-600 capitalize">
                  {user.role}
                </p>
              </div>
              <ChevronDown size={14} className="text-slate-600 transition" />
            </button>

            {/* Profile Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
                <div className="border-b border-slate-200 px-3 py-2.5">
                  <p className="text-xs font-bold text-slate-900 truncate">
                    {user.full_name || "Driver Account"}
                  </p>
                  <p className="text-[11px] text-slate-600 truncate">
                    {user.email}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                      <Shield size={10} />
                      <span className="capitalize">{user.role}</span>
                    </span>
                    <span className="text-[10px] text-slate-500">{today}</span>
                  </div>
                </div>

                <div className="py-1">
                  <Link
                    to="/workspace"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
                  >
                    <User size={14} className="text-slate-600" />
                    <span>Workspace Overview</span>
                  </Link>

                  <Link
                    to="/saved-routes"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
                  >
                    <Bookmark size={14} className="text-emerald-600" />
                    <span>Saved Corridors</span>
                  </Link>

                  <Link
                    to="/route-history"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
                  >
                    <History size={14} className="text-sky-600" />
                    <span>Route History</span>
                  </Link>

                  <Link
                    to="/profile"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
                  >
                    <User size={14} className="text-purple-400" />
                    <span>Profile & Security</span>
                  </Link>

                  {user?.role === "admin" && (
                    <Link
                      to="/admin"
                      onClick={() => setIsDropdownOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-indigo-400 hover:bg-indigo-500/10 transition"
                    >
                      <Shield size={14} className="text-indigo-400" />
                      <span>Admin Control Center</span>
                    </Link>
                  )}
                </div>

                <div className="border-t border-slate-200 pt-1">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    <LogOut size={14} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <LogIn size={13} />
              <span>Sign In</span>
            </Link>
            <Link
              to="/register"
              className="hidden sm:inline-flex rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-400 transition"
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
