import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "ishtirak.theme";

function storedTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme | null>(() => storedTheme());

  useEffect(() => {
    const root = document.documentElement;
    if (theme) {
      root.setAttribute("data-theme", theme);
      localStorage.setItem(STORAGE_KEY, theme);
    } else {
      root.removeAttribute("data-theme");
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [theme]);

  function toggle() {
    const currentlyDark = theme ? theme === "dark" : systemPrefersDark();
    setTheme(currentlyDark ? "light" : "dark");
  }

  return { theme, toggle, prefersDark: systemPrefersDark() };
}
