import type { CSSProperties } from "react";
import { PAPER } from "@/lib/client/pdf/templates/paper";
import type { CvSectionId, CvTemplate } from "@/lib/client/pdf/templates/types";

/**
 * Miniatura esquemática de um modelo de CV, desenhada só com os tokens do modelo (margens, alinhamento do nome,
 * cor de acento, linha sob o título, caixa alta, ordem das seções e layout das competências). Não usa dados do
 * usuário: é a "silhueta" do modelo. A prévia fiel é o PDF de verdade, ao lado.
 * As medidas usam `cqw` (largura do contêiner), então a miniatura escala com o tamanho do cartão.
 */
const PT = 0.3; // 1 pt do PDF (A4 = 595 pt) em cqw, ampliado (~1,8x) para a silhueta preencher a miniatura e ficar legível.
const cq = (pt: number) => `${(pt * PT).toFixed(2)}cqw`;


function Line({ w, strong = false, h = 3.2 }: { w: string; strong?: boolean; h?: number }) {
  return <span className="block rounded-full" style={{ width: w, height: cq(h), background: strong ? PAPER.strong : PAPER.line }} />;
}

function Title({ t }: { t: CvTemplate }) {
  const { accent, titleRule, titleCase } = t.tokens;
  return (
    <span className="flex flex-col" style={{ gap: cq(2.5) }}>
      <span
        className="block rounded-full"
        style={{ width: titleCase === "upper" ? "42%" : "32%", height: cq(titleCase === "upper" ? 4.6 : 5.2), background: accent }}
      />
      {titleRule && <span className="block" style={{ height: "max(1px, 0.3cqw)", background: accent, opacity: 0.55 }} />}
    </span>
  );
}

function Body({ id, t }: { id: CvSectionId; t: CvTemplate }) {
  const gap = { gap: cq(2.6) };
  switch (id) {
    case "summary":
      return (
        <span className="flex flex-col" style={gap}>
          <Line w="100%" />
          <Line w="86%" />
        </span>
      );
    case "highlights":
      return (
        <span className="flex flex-col" style={gap}>
          {["92%", "80%", "70%"].map((w) => (
            <Line key={w} w={w} strong={t.boldHighlights} h={3.8} />
          ))}
        </span>
      );
    case "experience":
      return (
        <span className="flex flex-col" style={{ gap: cq(5) }}>
          {[0, 1].map((i) => (
            <span key={i} className="flex flex-col" style={gap}>
              <span className="flex justify-between">
                <Line w="46%" strong h={3.8} />
                <Line w="18%" />
              </span>
              <Line w="94%" />
              <Line w="78%" />
            </span>
          ))}
        </span>
      );
    case "skills":
      return t.skillsLayout === "grouped" ? (
        <span className="flex flex-col" style={gap}>
          {["70%", "56%"].map((w) => (
            <span key={w} className="flex items-center" style={{ gap: cq(3) }}>
              <Line w="16%" strong />
              <Line w={w} />
            </span>
          ))}
        </span>
      ) : (
        <Line w="88%" />
      );
    case "projects":
      return (
        <span className="flex flex-col" style={gap}>
          <Line w="36%" strong h={3.8} />
          <Line w="82%" />
          {t.projectStacksOnOwnLine && <Line w="40%" />}
        </span>
      );
    case "education":
      return (
        <span className="flex flex-col" style={gap}>
          <Line w="58%" strong h={3.8} />
          <Line w="40%" />
        </span>
      );
    default:
      return <Line w="52%" />;
  }
}

export function TemplateThumb({ template: t, className = "" }: { template: CvTemplate; className?: string }) {
  const { margins, nameSize, nameAlign, sectionGap } = t.tokens;
  const center = nameAlign === "center";
  const serif = t.font.headings === "Source Serif 4";
  const page: CSSProperties = {
    padding: `${cq(margins.v)} ${cq(margins.h)}`,
    background: PAPER.bg,
    gap: cq(sectionGap * 0.9),
  };
  return (
    <span aria-hidden="true" className={`@container block ${className}`}>
      <span
        className="flex aspect-[210/297] w-full flex-col overflow-hidden rounded-[4px] shadow-[0_1px_2px_rgba(16,18,22,0.18),0_6px_16px_-6px_rgba(16,18,22,0.28)]"
        style={page}
      >
        <span className={`flex flex-col ${center ? "items-center" : "items-start"}`} style={{ gap: cq(3) }}>
          <span
            className="leading-none font-bold whitespace-nowrap"
            style={{ color: PAPER.ink, fontSize: cq(nameSize * 0.95), fontFamily: serif ? "Georgia, 'Times New Roman', serif" : "inherit" }}
          >
            Ana Souza
          </span>
          <Line w="54%" />
          {t.locationLine && <Line w="34%" strong />}
        </span>
        {t.sections.map((id) => (
          <span key={id} className="flex flex-col" style={{ gap: cq(4) }}>
            <Title t={t} />
            <Body id={id} t={t} />
          </span>
        ))}
      </span>
    </span>
  );
}
