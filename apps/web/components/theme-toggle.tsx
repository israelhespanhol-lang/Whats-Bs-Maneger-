"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * The root layout applies the saved theme before rendering.
 * Do not temporarily write "light" when this button mounts: the sidebar
 * unmounts on route changes, and that used to flash the entire page white.
 */
function readAppliedTheme(): Theme {
  if (typeof document === "undefined") return "dark";

  const applied = document.documentElement.dataset.theme;
  if (applied === "dark" || applied === "light") return applied;

  try {
    const saved = window.localStorage.getItem("whats-bs-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Storage may be unavailable; prefer the user's system theme.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export default function ThemeToggle() {
  // Null only affects the button label while hydrating; it never changes
  // the document theme until the user explicitly clicks the control.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readAppliedTheme());
  }, []);

  const nextTheme: Theme =
    (theme ?? "dark") === "dark" ? "light" : "dark";

  function toggleTheme() {
    // Read from the document to handle navigation before hydration, too.
    const next: Theme = readAppliedTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      window.localStorage.setItem("whats-bs-theme", next);
    } catch {
      // The theme still changes in this session.
    }
    setTheme(next);
  }

  return (
    <button
      className="themeToggle"
      type="button"
      aria-label={`Ativar modo ${nextTheme === "dark" ? "escuro" : "claro"}`}
      title={`Ativar modo ${nextTheme === "dark" ? "escuro" : "claro"}`}
      onClick={toggleTheme}
    >
      <span className="themeIcon" aria-hidden="true">
        {theme === null ? "◐" : theme === "dark" ? "☀" : "☾"}
      </span>
      <span className="themeText">
        {theme === null
          ? "Aparência"
          : theme === "dark"
            ? "Modo claro"
            : "Modo escuro"}
      </span>
    </button>
  );
}
