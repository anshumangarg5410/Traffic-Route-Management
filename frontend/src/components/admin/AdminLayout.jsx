import { useState } from "react";
import AdminSidebar from "./AdminSidebar";
import AdminHeader from "./AdminHeader";

/**
 * AdminLayout
 * Top-level operations shell for the ITMS Admin Control Center.
 * Distinct visual identity:
 * - Dark navy/charcoal sidebar (authoritative operations feel)
 * - Clean neutral light content surface (slate-50/white)
 * - Responsive mobile navigation drawer
 */
export default function AdminLayout({ children }) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 antialiased">
      {/* Admin Operations Sidebar */}
      <AdminSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Administrative Viewport */}
      <div className="flex min-h-screen flex-col lg:ml-64">
        {/* Operations Header */}
        <AdminHeader
          onToggleSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
        />

        {/* Dynamic Admin Page Container */}
        <main className="flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>

        {/* Restrained Operations Footer */}
        <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
          <div className="flex flex-col sm:flex-row items-center justify-between max-w-7xl mx-auto gap-2">
            <p>
              ITMS Admin Control Center • Chandigarh Tricity Operations
            </p>
            <p className="text-[11px] text-slate-400 font-mono">
              Role: System Administrator (RBAC Active)
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
