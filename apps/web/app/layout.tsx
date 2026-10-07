import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Whats BS Manager",
  description: "Gerenciamento de WhatsApp Business"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
