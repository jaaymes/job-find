import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { VercelAnalytics } from "@/components/layout/VercelAnalytics";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/shared/theme-color";
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

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
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
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-jf-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-jf-on-brand focus:outline-2 focus:outline-offset-2 focus:outline-jf-brand"
        >
          Pular para o conteúdo
        </a>
        <Providers>{children}</Providers>
        {/* Só em builds na Vercel (VERCEL=1, variável de sistema dela): fora dela /_vercel/insights não
            existe e o script vira erro de console no `next dev`, no `next start` local e nos e2e. */}
        {process.env.VERCEL === "1" && <VercelAnalytics />}
      </body>
    </html>
  );
}
