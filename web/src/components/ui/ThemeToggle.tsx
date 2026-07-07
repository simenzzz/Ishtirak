import { Moon, Sun } from "lucide-react";

import { useTheme } from "../../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle, prefersDark } = useTheme();
  const isDark = theme ? theme === "dark" : prefersDark;
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}
