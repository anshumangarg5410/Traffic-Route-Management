import { useEffect } from "react";
import { NavLink, Link } from "react-router-dom";
import {
  LayoutDashboard,
  BrainCircuit,
  TrafficCone,
  Activity,
  GitCompareArrows,
  CarFront,
  Network,
  ShieldCheck,
  Navigation,
  Bookmark,
  History,
  User,
  LogOut,
  X,
  Cpu,
  LogIn,
  FlaskConical,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const navigation = [
  {
    title: "USER WORKSPACE",
    items: [
      { name: "Overview", path: "/workspace", icon: LayoutDashboard },
      { name: "Smart Route Planner", path: "/routes", icon: Navigation },
      { name: "Saved Corridors", path: "/saved-routes", icon: Bookmark },
      { name: "Search History", path: "/route-history", icon: History },
      { name: "Profile & Settings", path: "/profile", icon: User },
    ],
  },
  {
    title: "TRAFFIC AI SUITE",
    items: [
      { name: "System Dashboard", path: "/traffic-dashboard", icon: Cpu },
      { name: "Traffic Prediction", path: "/prediction", icon: BrainCircuit },
      { name: "Signal Optimization", path: "/optimization", icon: TrafficCone },
      { name: "Traffic Simulation", path: "/simulation", icon: CarFront },
      { name: "Strategy Comparison", path: "/comparison", icon: GitCompareArrows },
      { name: "Validation & Sensitivity", path: "/validation", icon: ShieldCheck },
      { name: "ML Laboratory", path: "/ml-lab", icon: FlaskConical },
    ],
  },
];

export default function Sidebar({ isOpen = false, onClose }) {
  const { user, isAuthenticated, logout } = useAuth();

  const handleNavClick = () => {
    if (onClose) {
      onClose();
    }
  };

  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Drawer */}
      <aside
        aria-label="Workspace navigation"
        className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-slate-800 bg-slate-950 text-slate-300 transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-20 items-center justify-between border-b border-slate-800 px-6">
          <Link
            to="/workspace"
            onClick={handleNavClick}
            className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <div className="rounded-xl bg-emerald-500 p-2 text-slate-950 shadow-md shadow-emerald-500/20">
              <Network size={22} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide text-white">
                ITMS
              </h1>
              <p className="text-[11px] text-slate-400">
                Chandigarh Tricity
              </p>
            </div>
          </Link>

          {/* Mobile Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-900 hover:text-white lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-6">
          {navigation.map((group) => (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-slate-500">
                {group.title}
              </p>

              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/workspace" || item.path === "/traffic-dashboard"}
                      onClick={handleNavClick}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                          isActive
                            ? "bg-emerald-500/10 font-semibold text-emerald-400"
                            : "text-slate-400 hover:bg-slate-900 hover:text-white"
                        }`
                      }
                    >
                      <Icon size={17} />
                      <span>{item.name}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Admin Control Center Navigation (Strictly visible only to authenticated admins) */}
          {isAuthenticated && user?.role === "admin" && (
            <div>
              <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-indigo-400">
                ADMINISTRATION
              </p>
              <div className="space-y-1">
                <Link
                  to="/admin"
                  onClick={handleNavClick}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 hover:text-indigo-200 border border-indigo-500/20 transition"
                >
                  <ShieldCheck size={17} className="text-indigo-400" />
                  <span>Admin Control Center</span>
                </Link>
              </div>
            </div>
          )}
        </nav>

        {/* User Footer / Auth Status */}
        <div className="border-t border-slate-800 p-4">
          {isAuthenticated && user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-slate-900/60 p-2.5 border border-slate-800/80">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-sm font-bold text-emerald-400">
                  {user.full_name ? user.full_name[0].toUpperCase() : user.email[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">
                    {user.full_name || "Driver Account"}
                  </p>
                  <p className="truncate text-[10px] text-slate-400">
                    {user.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition"
                  title="Sign out of current session"
                  aria-label="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>

              <div className="flex items-center justify-between px-1 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Activity size={12} className="text-emerald-400" />
                  <span>Network</span>
                </span>
                <span className="font-mono text-emerald-400">Online</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Link
                to="/login"
                onClick={handleNavClick}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                <LogIn size={14} />
                <span>Sign In</span>
              </Link>
              <div className="text-center">
                <Link
                  to="/register"
                  onClick={handleNavClick}
                  className="text-[11px] text-slate-400 hover:text-white transition"
                >
                  Create an account
                </Link>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
