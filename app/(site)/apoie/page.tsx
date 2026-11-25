import type { Metadata } from "next";
import type { ReactNode } from "react";
import QRCode from "qrcode";
import { CopyPixKey } from "@/components/donation/CopyPixKey";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { GITHUB_SPONSORS_URL, PIX } from "@/lib/shared/donation";
import { buildPixPayload } from "@/lib/shared/pix";

export const metadata: Metadata = {
  title: "Job Find — Apoie o projeto",
  description: "O Job Find é gratuito e open-source. Se ele te ajudou, apoie com um Pix ou pelo GitHub Sponsors.",
};

function Channel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
      <h2 className="font-display text-xl font-bold text-jf-ink">{title}</h2>
      {children}
    </section>
  );
}

// Página estática (D-01): o QR é gerado no build, sem script de terceiros no navegador.
export default async function ApoiePage() {
  const payload = buildPixPayload(PIX);
  const svg = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  const qrSrc = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return (
    <>
      <SiteHeader current="apoie" />
      <main id="conteudo" className="mx-auto flex w-full max-w-[800px] flex-1 flex-col gap-7 px-4 pt-6 pb-16 text-[15px] leading-relaxed text-jf-ink-2 sm:px-6 sm:pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[28px] leading-tight font-bold text-jf-ink">Apoie o projeto</h1>
          <p>
            O Job Find é gratuito, open-source e sem anúncios. Se ele te ajudou a encontrar vagas ou a adaptar o seu
            currículo, você pode apoiar com qualquer valor. O apoio ajuda a pagar a hospedagem e a manter as fontes de
            vagas funcionando.
          </p>
        </div>

        <Channel title="Pix">
          <div className="flex flex-col items-start gap-5 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG gerado no build, em data URL */}
            <img
              src={qrSrc}
              alt="QR code do Pix para apoiar o Job Find"
              width={176}
              height={176}
              className="shrink-0 rounded-lg border border-jf-line"
            />
            <div className="flex min-w-0 flex-col gap-3">
              <p>Aponte a câmera do app do seu banco para o QR code e escolha o valor.</p>
              <p className="text-[13px] text-jf-ink-3">Chave aleatória</p>
              <code className="rounded-lg bg-jf-chip px-3 py-2 font-mono text-[13px] break-all text-jf-ink select-all">
                {PIX.key}
              </code>
              <CopyPixKey value={PIX.key} label="Copiar chave Pix" />
              <CopyPixKey value={payload} label="Copiar Pix copia e cola" />
            </div>
          </div>
        </Channel>

        <Channel title="GitHub Sponsors">
          <p>Para apoiar em dólar, com cartão, ou de forma recorrente.</p>
          <a href={GITHUB_SPONSORS_URL} className={`${BTN_PRIMARY} self-start no-underline`} rel="noopener noreferrer">
            Apoiar no GitHub Sponsors
          </a>
        </Channel>

        <p className="text-[13px] text-jf-ink-3">
          Não tem como apoiar com dinheiro? Contar do Job Find para alguém que está procurando vaga também ajuda muito.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
