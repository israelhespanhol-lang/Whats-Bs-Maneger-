import "./globals.css";
import "./product-sections.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mais Chat",
  description: "Central de atendimento da Mais Viagens"
};

const themeBootstrap = `
  (() => {
    try {
      const saved = localStorage.getItem("whats-bs-theme");
      const theme =
        saved === "dark" || saved === "light"
          ? saved
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {}
  })();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
