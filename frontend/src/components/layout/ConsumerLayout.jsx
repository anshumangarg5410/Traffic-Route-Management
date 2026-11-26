import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Navigation,
  Menu,
  X,
  LayoutDashboard,
  Bookmark,
  Shield,
  LogIn,
  ArrowRight,
  MapPin,
  Route,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const PUBLIC_NAV_LINKS = [
  { label: "Home", to: "/", end: true },
  { label: "Features", to: "/features" },
  { label: "How It Works", to: "/how-it-works" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

const TRICITY_COVERAGE = [
  "Chandigarh",
  "Mohali",
  "Panchkula",
  "Zirakpur",
  "Kharar",
  "New Chandigarh",
  "Dera Bassi",
];

/**
 * ConsumerLayout
 * ==============
 * Public-facing SaaS navigation shell and footer for all ITMS public pages:
 * `/`, `/features`, `/how-it-works`, `/about`, `/contact`, and `/route-planner`.
 */
export default function ConsumerLayout({ children, compactFooter = false }) {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isPlanner = location.pathname === "/route-planner";
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          {/* Left: Brand Logo */}
          <Link
            to="/"
            className="flex items-center gap-2.5 text-slate-900 hover:opacity-90 transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600">
              <Navigation size={18} />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 block leading-tight">
                ITMS
              </span>
              <span className="hidden sm:block text-[10px] font-medium text-slate-600 leading-none">
                Intelligent Traffic Management
              </span>
            </div>
          </Link>

          {/* Center: Desktop Navigation Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden lg:flex items-center gap-6 text-sm font-medium"
          >
            {PUBLIC_NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `transition rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                    isActive
                      ? "text-emerald-600 font-semibold"
                      : "text-slate-700 hover:text-slate-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right: Plan a Journey + Auth / Get Started */}
          <div className="hidden lg:flex items-center gap-2.5 shrink-0">
            <Link
              to="/route-planner"
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                isPlanner
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              <Route size={14} className="text-emerald-600" />
              <span>Plan a Journey</span>
            </Link>

            {isAuthenticated && user ? (
              <>
                <Link
                  to="/saved-routes"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition"
                >
                  <Bookmark size={14} className="text-emerald-600" />
                  <span>Saved Routes</span>
                </Link>
                <Link
                  to="/workspace"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
                >
                  <LayoutDashboard size={14} />
                  <span>Workspace</span>
                </Link>
                {user.role === "admin" && (
                  <Link
                    to="/admin"
                    className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 transition"
                  >
                    <Shield size={14} />
                    <span>Admin</span>
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 hover:border-slate-300 hover:text-slate-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <LogIn size={14} />
                  <span>Login</span>
                </Link>
                <Link
                  to="/register"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <span>Get Started</span>
                  <ArrowRight size={14} />
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:text-slate-900 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-3 lg:hidden">
            <div className="flex flex-col space-y-1 text-sm">
              {PUBLIC_NAV_LINKS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2 transition ${
                      isActive
                        ? "bg-emerald-500/10 text-emerald-600 font-semibold"
                        : "text-slate-700 hover:bg-white hover:text-slate-900"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <Link
                to="/route-planner"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-cyan-300 font-medium hover:bg-white flex items-center gap-2"
              >
                <Route size={15} />
                <span>Plan a Journey</span>
              </Link>
            </div>

            <div className="border-t border-slate-200 pt-3 flex flex-wrap gap-2">
              {isAuthenticated && user ? (
                <>
                  <Link
                    to="/workspace"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Workspace
                  </Link>
                  <Link
                    to="/saved-routes"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                  >
                    Saved Routes
                  </Link>
                  {user.role === "admin" && (
                    <Link
                      to="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex-1 text-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700"
                    >
                      Admin
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                  >
                    Login
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Consistent Professional Footer */}
      <footer className="border-t border-slate-200 bg-slate-50 text-slate-600">
        <div
          className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${
            compactFooter ? "py-6" : "py-12"
          }`}
        >
          {!compactFooter ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-12 pb-8 border-b border-slate-200">
              <div className="md:col-span-5 space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600">
                    <Navigation size={14} />
                  </div>
                  <span>ITMS</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed max-w-sm">
                  Intelligent Traffic Management System — an urban mobility and
                  multi-criteria route-planning platform built for Chandigarh
                  Tricity.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {TRICITY_COVERAGE.map((city) => (
                    <span
                      key={city}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                    >
                      <MapPin size={10} className="text-emerald-600" />
                      <span>{city}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2 space-y-2.5 text-xs">
                <p className="font-semibold text-slate-900 uppercase tracking-wider text-[11px]">
                  Product
                </p>
                <ul className="space-y-2">
                  <li>
                    <Link to="/" className="hover:text-slate-900 transition">
                      Home
                    </Link>
                  </li>
                  <li>
                    <Link to="/features" className="hover:text-slate-900 transition">
                      Features
                    </Link>
                  </li>
                  <li>
                    <Link to="/how-it-works" className="hover:text-slate-900 transition">
                      How It Works
                    </Link>
                  </li>
                  <li>
                    <Link to="/route-planner" className="hover:text-slate-900 transition">
                      Plan a Journey
                    </Link>
                  </li>
                </ul>
              </div>

              <div className="md:col-span-2 space-y-2.5 text-xs">
                <p className="font-semibold text-slate-900 uppercase tracking-wider text-[11px]">
                  Platform
                </p>
                <ul className="space-y-2">
                  <li>
                    <Link to="/about" className="hover:text-slate-900 transition">
                      About ITMS
                    </Link>
                  </li>
                  <li>
                    <Link to="/contact" className="hover:text-slate-900 transition">
                      Contact
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/how-it-works#ml-transparency"
                      className="hover:text-slate-900 transition"
                    >
                      ML Transparency
                    </Link>
                  </li>
                </ul>
              </div>

              <div className="md:col-span-3 space-y-2.5 text-xs">
                <p className="font-semibold text-slate-900 uppercase tracking-wider text-[11px]">
                  Account
                </p>
                <ul className="space-y-2">
                  {isAuthenticated ? (
                    <>
                      <li>
                        <Link to="/workspace" className="hover:text-slate-900 transition">
                          User Workspace
                        </Link>
                      </li>
                      <li>
                        <Link to="/saved-routes" className="hover:text-slate-900 transition">
                          Saved Routes
                        </Link>
                      </li>
                      <li>
                        <Link to="/route-history" className="hover:text-slate-900 transition">
                          Route History
                        </Link>
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <Link to="/login" className="hover:text-slate-900 transition">
                          Sign In
                        </Link>
                      </li>
                      <li>
                        <Link to="/register" className="hover:text-slate-900 transition">
                          Create Account
                        </Link>
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          ) : null}

          <div
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-500 ${
              compactFooter ? "" : "pt-6"
            }`}
          >
            <p>
              &copy; {currentYear} ITMS — Intelligent Traffic Management System.
              Chandigarh Tricity.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link to="/how-it-works#ml-transparency" className="hover:text-slate-700 transition">
                Methodology &amp; Disclaimers
              </Link>
              <Link to="/about" className="hover:text-slate-700 transition">
                About
              </Link>
              <Link to="/contact" className="hover:text-slate-700 transition">
                Contact
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
