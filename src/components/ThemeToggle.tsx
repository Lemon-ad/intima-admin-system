import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "intima_theme";

function getInitial(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: "light" | "dark") {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function initTheme() {
  if (typeof window === "undefined") return;
  apply(getInitial());
}

export default function ThemeToggle({
  variant = "ghost",
  size = "icon",
}: {
  variant?: "ghost" | "outline";
  size?: "icon" | "sm";
}) {
  const [theme, setTheme] = useState<"light" | "dark">(() => getInitial());

  useEffect(() => {
    apply(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      aria-label="Toggle theme"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
