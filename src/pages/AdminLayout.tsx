import { useEffect, useState } from "react";
import { Outlet, useNavigate, Link, useLocation } from "react-router-dom";
import { isAuthenticated, clearAdminAuth, getCurrentRole } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, Users, Calendar, Settings, LogOut, List, GraduationCap, Menu, X, Cake } from "lucide-react";
import intimaLogo from "@/assets/intima-logo.png";
import ThemeToggle from "@/components/ThemeToggle";

const navItems = [
  { to: "/admin/dashboard", icon: LayoutDashboard, label: "Dashboard", adminOnly: false },
  { to: "/admin/members", icon: Users, label: "Members", adminOnly: false },
  { to: "/admin/schedules", icon: List, label: "Schedules", adminOnly: false },
  { to: "/admin/exams", icon: GraduationCap, label: "Exam Period", adminOnly: false },
  { to: "/admin/birthdays", icon: Cake, label: "Birthdays", adminOnly: false },
  { to: "/admin/settings", icon: Settings, label: "Settings", adminOnly: true },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = getCurrentRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin");
    }
  }, [navigate]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    clearAdminAuth();
    navigate("/admin");
  };

  if (!isAuthenticated()) return null;

  const visibleNav = navItems.filter((i) => !i.adminOnly || role === "admin");

  const SidebarInner = (
    <>
      <div className="p-4 border-b border-border flex items-center gap-3">
        <img src={intimaLogo} alt="INTIMA" className="h-10" />
        <div className="flex flex-col">
          <p className="text-xs text-muted-foreground">Schedule Arranger</p>
          {role === "public" && (
            <Badge variant="outline" className="text-[10px] mt-0.5 w-fit">View-only</Badge>
          )}
          {role === "admin" && (
            <Badge className="text-[10px] mt-0.5 w-fit bg-primary text-primary-foreground">Admin</Badge>
          )}
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => {
          const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          return (
            <Link key={item.to} to={item.to}>
              <Button
                variant={active ? "secondary" : "ghost"}
                className={`w-full justify-start gap-3 ${active ? "bg-accent text-accent-foreground font-medium" : ""}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border space-y-1">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 border-b border-border bg-card flex items-center justify-between px-3">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
        <img src={intimaLogo} alt="INTIMA" className="h-8" />
        <ThemeToggle />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-card border-r border-border flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 p-1 rounded hover:bg-accent z-10"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            {SidebarInner}
          </aside>
        </div>
      )}

      {/* Desktop sidebar — fixed to viewport */}
      <aside className="hidden lg:flex w-64 border-r border-border bg-card flex-col shrink-0 fixed inset-y-0 left-0 z-30">
        {SidebarInner}
      </aside>

      {/* Main content — offset for fixed sidebar / mobile bar */}
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
