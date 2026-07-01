import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoadingScreen } from "@/components/LoadingScreen";

// Eagerly load only the lightweight public landing + auth gates so first paint
// stays instant. Everything else is split into its own chunk.
import Index from "./pages/Index";
import AdminLogin from "./pages/AdminLogin";

// Lazy chunks — kept as module-level promises so we can prefetch them
// proactively (once the user is past the login screen) and avoid showing
// the Suspense fallback on every tab switch.
const loadAdminLayout = () => import("./pages/AdminLayout");
const loadAdminDashboard = () => import("./pages/AdminDashboard");
const loadAdminMembers = () => import("./pages/AdminMembers");
const loadAdminScheduleList = () => import("./pages/AdminScheduleList");
const loadAdminScheduleEditor = () => import("./pages/AdminScheduleEditor");
const loadAdminExams = () => import("./pages/AdminExams");
const loadAdminBirthdays = () => import("./pages/AdminBirthdays");
const loadAdminSettings = () => import("./pages/AdminSettings");
const loadPublicMember = () => import("./pages/PublicMember");
const loadPublicExco = () => import("./pages/PublicExco");

const AdminLayout = lazy(loadAdminLayout);
const AdminDashboard = lazy(loadAdminDashboard);
const AdminMembers = lazy(loadAdminMembers);
const AdminScheduleList = lazy(loadAdminScheduleList);
const AdminScheduleEditor = lazy(loadAdminScheduleEditor);
const AdminExams = lazy(loadAdminExams);
const AdminBirthdays = lazy(loadAdminBirthdays);
const AdminSettings = lazy(loadAdminSettings);
const PublicMember = lazy(loadPublicMember);
const PublicExco = lazy(loadPublicExco);
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => <LoadingScreen />;

// Prefetch all sibling admin pages once any admin route is reached so that
// subsequent tab switches resolve instantly with no Suspense flash.
const PrefetchAdminChunks = () => {
  useEffect(() => {
    const idle = (cb: () => void) =>
      "requestIdleCallback" in window
        ? (window as any).requestIdleCallback(cb)
        : setTimeout(cb, 200);
    idle(() => {
      loadAdminDashboard();
      loadAdminMembers();
      loadAdminScheduleList();
      loadAdminScheduleEditor();
      loadAdminExams();
      loadAdminBirthdays();
      loadAdminSettings();
    });
  }, []);
  return null;
};


const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/admin" element={<AdminLogin />} />
            <Route element={<><PrefetchAdminChunks /><AdminLayout /></>}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/members" element={<AdminMembers />} />
              <Route path="/admin/schedules" element={<AdminScheduleList />} />
              <Route path="/admin/schedules/:id" element={<AdminScheduleEditor />} />
              <Route path="/admin/exams" element={<AdminExams />} />
              <Route path="/admin/birthdays" element={<AdminBirthdays />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
            </Route>
            <Route path="/member" element={<PublicMember />} />
            <Route path="/exco" element={<PublicExco />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
