"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const saved = window.localStorage.getItem("whats-bs-theme");
  if (saved === "light" || saved === "dark") return saved;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(resolveInitialTheme());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("whats-bs-theme", theme);
  }, [theme]);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      className="themeToggle"
      type="button"
      aria-label={`Ativar modo ${nextTheme === "dark" ? "escuro" : "claro"}`}
      title={`Ativar modo ${nextTheme === "dark" ? "escuro" : "claro"}`}
      onClick={() => setTheme(nextTheme)}
    >
      <span className="themeIcon" aria-hidden="true">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      <span className="themeText">
        {theme === "dark" ? "Modo claro" : "Modo escuro"}
      </span>
    </button>
  );
}
