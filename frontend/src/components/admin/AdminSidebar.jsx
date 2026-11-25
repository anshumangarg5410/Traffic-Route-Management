import { NavLink, Link, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Database,
  BrainCircuit,
  Server,
  ScrollText,
  ArrowLeft,
  LogOut,
  X,
  Shield,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const adminNavItems = [
  { name: "Overview", path: "/admin", icon: LayoutDashboard, end: true },
  { name: "User Management", path: "/admin/users", icon: Users },
  { name: "Traffic Data", path: "/admin/traffic-data", icon: Database },
  { name: "ML Models", path: "/admin/models", icon: BrainCircuit },
  { name: "System Monitoring", path: "/admin/system", icon: Server },
  { name: "Audit Logs", path: "/admin/audit-logs", icon: ScrollText },
];

export default function AdminSidebar({ isOpen = false, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleNavClick = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleSignOut = async () => {
    if (onClose) onClose();
    await logout();
    navigate("/login");
  };

  return (
    <>
      {/* Mobile Drawer Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Admin Sidebar Navigation */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-slate-800 bg-[#0B1120] text-slate-300 transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-20 items-center justify-between border-b border-slate-800/80 px-6">
          <Link to="/admin" onClick={handleNavClick} className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-600 p-2 text-white shadow-md shadow-indigo-500/20">
              <Shield size={20} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-bold tracking-wide text-white">
                  ITMS ADMIN
                </h1>
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.2 text-[9px] font-bold text-indigo-400 border border-indigo-500/30">
                  OPS
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Operations Control Room
              </p>
            </div>
          </Link>

          {/* Mobile Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-900 hover:text-white lg:hidden"
            aria-label="Close admin menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
          <div>
            <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-slate-500">
              ADMIN CONTROL CENTER
            </p>

            <div className="space-y-1">
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.end}
                    onClick={handleNavClick}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                        isActive
                          ? "bg-indigo-600/20 font-semibold text-indigo-300 border-l-2 border-indigo-500"
                          : "text-slate-400 hover:bg-slate-900/80 hover:text-white"
                      }`
                    }
                  >
                    <Icon size={17} className="shrink-0" />
                    <span>{item.name}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>

          {/* User Workspace Integration Link */}
          <div className="border-t border-slate-800/80 pt-4">
            <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-slate-500">
              USER INTERFACE
            </p>
            <Link
              to="/workspace"
              onClick={handleNavClick}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-emerald-400 transition group"
            >
              <ArrowLeft size={16} className="text-slate-500 group-hover:text-emerald-400 group-hover:-translate-x-0.5 transition-transform" />
              <span>Return to Workspace</span>
            </Link>
          </div>
        </nav>

        {/* Admin Identity & Session Footer */}
        <div className="border-t border-slate-800/80 p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-slate-900/80 p-2.5 border border-slate-800">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-sm font-bold text-indigo-300">
                {user?.full_name ? user.full_name[0].toUpperCase() : "A"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">
                  {user?.full_name || "Administrator"}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  <p className="truncate text-[10px] text-indigo-300 font-medium">
                    Admin Privilege
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition"
                title="Sign out of administrative session"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>

            <div className="flex items-center justify-between px-1 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <Shield size={12} className="text-indigo-400" />
                <span>Control Plane</span>
              </span>
              <span className="font-mono text-slate-400">Secured</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
