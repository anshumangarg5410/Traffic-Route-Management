import { lazy, Suspense, useState } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import Sidebar from "./components/layout/Sidebar";
import Header from "./components/layout/Header";
import ConsumerLayout from "./components/layout/ConsumerLayout";

import { AuthProvider } from "./context/AuthContext";
import { TrafficProvider } from "./context/TrafficContext";

import ProtectedRoute from "./components/auth/ProtectedRoute";
import PublicRoute from "./components/auth/PublicRoute";
import AdminRoute from "./components/admin/AdminRoute";
import AdminLayout from "./components/admin/AdminLayout";

import LandingPage from "./pages/LandingPage";
import Features from "./pages/Features";
import HowItWorks from "./pages/HowItWorks";
import About from "./pages/About";
import Contact from "./pages/Contact";
import UserDashboard from "./pages/UserDashboard";
import SavedRoutes from "./pages/SavedRoutes";
import RouteHistory from "./pages/RouteHistory";
import ProfileSettings from "./pages/ProfileSettings";
import Login from "./pages/Login";
import Register from "./pages/Register";

import SmartRoutePlanner from "./pages/SmartRoutePlanner";

// Lazy-loaded Engineering Suite & Admin Control Center pages
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Prediction = lazy(() => import("./pages/Prediction"));
const SignalOptimization = lazy(() => import("./pages/SignalOptimization"));
const Simulation = lazy(() => import("./pages/Simulation"));
const Comparison = lazy(() => import("./pages/Comparison"));
const Validation = lazy(() => import("./pages/Validation"));
const MlLaboratory = lazy(() => import("./pages/MlLaboratory"));

const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminTrafficData = lazy(() => import("./pages/admin/AdminTrafficData"));
const AdminModels = lazy(() => import("./pages/admin/AdminModels"));
const AdminSystem = lazy(() => import("./pages/admin/AdminSystem"));
const AdminAuditLogs = lazy(() => import("./pages/admin/AdminAuditLogs"));

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-emerald-600">
      <Loader2 className="animate-spin" size={28} />
    </div>
  );
}

function AppContent() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const location = useLocation();

  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/register";

  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicRoute>
                <Register />
              </PublicRoute>
            }
          />
        </Routes>
      </div>
    );
  }

  // Admin Control Center (Separate Layout & Guarded by AdminRoute)
  const isAdminPage = location.pathname.startsWith("/admin");
  if (isAdminPage) {
    return (
      <AdminRoute>
        <AdminLayout>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/traffic-data" element={<AdminTrafficData />} />
              <Route path="/admin/models" element={<AdminModels />} />
              <Route path="/admin/system" element={<AdminSystem />} />
              <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
              <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Suspense>
        </AdminLayout>
      </AdminRoute>
    );
  }

  // Public Consumer Website Shell (`/`, `/features`, `/how-it-works`, `/about`, `/contact`, `/route-planner`)
  const publicConsumerPaths = new Set([
    "/",
    "/features",
    "/how-it-works",
    "/about",
    "/contact",
    "/route-planner",
  ]);
  const isConsumerPage = publicConsumerPaths.has(location.pathname);
  if (isConsumerPage) {
    return (
      <ConsumerLayout compactFooter={location.pathname === "/route-planner"}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features" element={<Features />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/route-planner" element={<SmartRoutePlanner />} />
        </Routes>
      </ConsumerLayout>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Sidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div className="min-h-screen lg:ml-64">
        <Header onToggleSidebar={() => setIsMobileSidebarOpen((prev) => !prev)} />

        <main className="p-4 md:p-8">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Authenticated User Workspace (Canonical Dashboard) */}
              <Route
                path="/workspace"
                element={
                  <ProtectedRoute>
                    <UserDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/saved-routes"
                element={
                  <ProtectedRoute>
                    <SavedRoutes />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/route-history"
                element={
                  <ProtectedRoute>
                    <RouteHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfileSettings />
                  </ProtectedRoute>
                }
              />

              {/* Preserved Traffic Intelligence Suite & Route Planner */}
              <Route path="/traffic-dashboard" element={<Dashboard />} />
              <Route path="/routes" element={<SmartRoutePlanner />} />
              <Route path="/prediction" element={<Prediction />} />
              <Route path="/optimization" element={<SignalOptimization />} />
              <Route path="/simulation" element={<Simulation />} />
              <Route path="/comparison" element={<Comparison />} />
              <Route path="/validation" element={<Validation />} />
              <Route path="/ml-lab" element={<MlLaboratory />} />

              {/* Fallback to public landing page */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TrafficProvider>
        <AppContent />
      </TrafficProvider>
    </AuthProvider>
  );
}
