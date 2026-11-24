import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/shared/theme-script";
import { Providers } from "./providers";
import "./globals.css";

// Fontes auto-hospedadas no build (CSP: font-src 'self' data:).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Job Find — Vagas de tecnologia",
  description: "Agregador open-source de vagas de tecnologia, no Brasil e no exterior.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: o THEME_SCRIPT põe a classe `dark` e o color-scheme no <html> antes da hidratação.
    <html
      lang="pt-BR"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Aplica o tema antes da pintura (sem flash). O texto vai exatamente como exportado: nas rotas
            (local) ele é liberado pelo hash THEME_SCRIPT_HASH da CSP; na pública, por 'unsafe-inline'.
            Sem nonce de propósito: ler headers() aqui tornaria todas as páginas dinâmicas (D-15). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
