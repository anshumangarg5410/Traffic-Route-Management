import { useState } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";

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
import Dashboard from "./pages/Dashboard";
import Prediction from "./pages/Prediction";
import SignalOptimization from "./pages/SignalOptimization";
import Simulation from "./pages/Simulation";
import Comparison from "./pages/Comparison";
import Validation from "./pages/Validation";

// Admin Control Center Pages
import AdminOverview from "./pages/admin/AdminOverview";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminTrafficData from "./pages/admin/AdminTrafficData";
import AdminModels from "./pages/admin/AdminModels";
import AdminSystem from "./pages/admin/AdminSystem";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs";

function AppContent() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const location = useLocation();

  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/register";

  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-slate-950">
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
          <Routes>
            <Route path="/admin" element={<AdminOverview />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/traffic-data" element={<AdminTrafficData />} />
            <Route path="/admin/models" element={<AdminModels />} />
            <Route path="/admin/system" element={<AdminSystem />} />
            <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
            <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
          </Routes>
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Sidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div className="min-h-screen lg:ml-64">
        <Header onToggleSidebar={() => setIsMobileSidebarOpen((prev) => !prev)} />

        <main className="p-4 md:p-8">
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

            {/* Fallback to public landing page */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
