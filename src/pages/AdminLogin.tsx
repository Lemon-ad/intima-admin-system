import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { detectRoleFromPassword, setRole } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import intimaLogo from "@/assets/intima-logo.png";
import ThemeToggle from "@/components/ThemeToggle";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const role = await detectRoleFromPassword(password);
    if (role) {
      setRole(role);
      toast.success(role === "admin" ? "Welcome, Admin" : "Welcome (View-only access)");
      navigate("/admin/dashboard");
    } else {
      toast.error("Incorrect password");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm animate-fade-in shadow-lg">
        <CardHeader className="text-center">
          <img src={intimaLogo} alt="INTIMA" className="h-16 mx-auto mb-2" />
          <CardTitle className="text-xl font-bold">Sign In</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your <span className="font-medium text-foreground">Admin</span> or{" "}
            <span className="font-medium text-foreground">Public</span> password
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <Button type="submit" className="w-full intima-gradient text-primary-foreground" disabled={loading}>
              {loading ? "Verifying..." : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
