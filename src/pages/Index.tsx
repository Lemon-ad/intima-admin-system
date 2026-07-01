import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Users, LogIn } from "lucide-react";
import intimaLogo from "@/assets/intima-logo.png";
import ThemeToggle from "@/components/ThemeToggle";
import { getStandalonePreferredRoute } from "@/lib/pwaInstall";

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    const isStandalone =
      // @ts-ignore iOS Safari exposes this only at runtime
      window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
    const preferredRoute = getStandalonePreferredRoute();

    if (isStandalone && preferredRoute) {
      navigate(preferredRoute, { replace: true });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="text-center mb-12 animate-fade-in">
        <img src={intimaLogo} alt="INTIMA" className="h-24 mx-auto mb-4" />
        <p className="text-xl text-muted-foreground">Schedule Arranger</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg w-full animate-fade-in">
        <Button
          variant="outline"
          className="h-24 flex flex-col gap-2"
          onClick={() => navigate("/member")}
        >
          <Calendar className="h-6 w-6" />
          <span>Members' Schedules</span>
        </Button>
        <Button
          variant="outline"
          className="h-24 flex flex-col gap-2"
          onClick={() => navigate("/exco")}
        >
          <Users className="h-6 w-6" />
          <span>EXCO Schedules</span>
        </Button>
        <Button
          className="h-24 flex flex-col gap-2 intima-gradient text-primary-foreground"
          onClick={() => navigate("/admin")}
        >
          <LogIn className="h-6 w-6" />
          <span>Sign In</span>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mt-6 text-center max-w-md">
        Sign In supports both <span className="font-medium text-foreground">Admin</span> and{" "}
        <span className="font-medium text-foreground">Public</span> accounts.
      </p>
    </div>
  );
}
