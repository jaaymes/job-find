import { type ReactNode, useState } from "react";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import type { Review } from "@/lib/client/cv/review";
import type { Violation } from "@/lib/client/cv/validate";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { describeViolation } from "./violation-text";

export type EditorTab = "cv" | "letter";

type Props = {
  docs: TailoredDocs;
  review: Review;
  tab: EditorTab;
  showLetterTab: boolean;
  onTab: (t: EditorTab) => void;
  onChange: (docs: TailoredDocs) => void;
  onApprove: (key: string) => void;
};

type ItemState = { key: string; flagged: boolean; violations: Violation[] };

/**
 * Trecho em revisão: destaque, motivos e "Aprovar mesmo assim" (por trecho). Texto da IA sempre como texto.
 * `approvable`: violação de nível de experiência (repetida) não tem chave aprovável.
 */
function Item({
  state,
  approvable = true,
  onApprove,
  children,
}: {
  state: ItemState;
  approvable?: boolean;
  onApprove: (key: string) => void;
  children: ReactNode;
}) {
  if (!state.flagged) {
    return (
      <div className="flex flex-col gap-1">
        {children}
        {state.violations.length > 0 && <p className="text-xs text-jf-ink-3">Aprovado por você, mesmo com o aviso.</p>}
      </div>
    );
  }
  return (
    <div data-flagged="true" className="flex flex-col gap-2 rounded-xl border-2 border-[#E0B060] bg-jf-new-bg p-2.5">
      {children}
      <ul className="list-disc pl-[18px] text-[13px] text-jf-new-fg">
        {state.violations.map((v, i) => (
          <li key={i}>{describeViolation(v)}</li>
        ))}
      </ul>
      {approvable ? (
        <button type="button" className={`${BTN_OUTLINE} self-start`} onClick={() => onApprove(state.key)}>
          Aprovar mesmo assim
        </button>
      ) : (
        <p className="text-[13px] text-jf-new-fg">Corrija ou remova este trecho: ele não pode ser aprovado.</p>
      )}
    </div>
  );
}

let nextId = 0;
const seq = (n: number) => Array.from({ length: n }, () => nextId++);

const rowsFor = (text: string, perLine = 70) => Math.max(2, Math.ceil(text.length / perLine));

export function TailoredEditor({ docs, review, tab, showLetterTab, onTab, onChange, onApprove }: Props) {
  const { cv } = review;
  const setCv = (patch: Partial<TailoredDocs["cv"]>) => onChange({ ...docs, cv: { ...docs.cv, ...patch } });
  const occurrences = new Map<string, number>();
  // Ids estáveis por item (o editor remonta a cada nova geração, ver `key` no pai): remover um item não
  // desloca o estado dos vizinhos.
  const [ids, setIds] = useState(() => ({
    skills: seq(docs.cv.skills.length),
    bullets: docs.cv.experiences.map((e) => seq(e.bullets.length)),
  }));

  return (
    <section aria-label="Editor do CV e da carta" className={`${CARD} flex flex-col gap-4 p-4 sm:p-5`}>
      <div role="tablist" aria-label="Documento" className="flex gap-1 border-b border-jf-line">
        {(["cv", ...(showLetterTab ? (["letter"] as const) : [])] as EditorTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`min-h-11 rounded-t-lg px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-jf-brand ${
              tab === t ? "border-b-2 border-jf-brand text-jf-brand-dark" : "text-jf-ink-3 hover:text-jf-ink"
            }`}
            onClick={() => onTab(t)}
          >
            {t === "cv" ? "Currículo" : "Carta de apresentação"}
          </button>
        ))}
      </div>

      {tab === "letter" && docs.coverLetter !== null ? (
        <div role="tabpanel" className="flex flex-col gap-3">
          <Item
            state={{ key: review.letter.key ?? "", flagged: review.letter.flagged, violations: review.letter.violations }}
            onApprove={onApprove}
          >
            <label className={FIELD_LABEL}>
              Texto da carta
              <textarea
                className={`${FIELD} resize-y leading-relaxed`}
                rows={Math.max(8, rowsFor(docs.coverLetter, 80))}
                value={docs.coverLetter}
                onChange={(e) => onChange({ ...docs, coverLetter: e.target.value })}
              />
            </label>
          </Item>
        </div>
      ) : (
        <div role="tabpanel" className="flex flex-col gap-5">
          <Item state={cv.flags.headline} onApprove={onApprove}>
            <label className={FIELD_LABEL}>
              Título profissional
              <input className={FIELD} value={docs.cv.headline} onChange={(e) => setCv({ headline: e.target.value })} />
            </label>
          </Item>
          <Item state={cv.flags.summary} onApprove={onApprove}>
            <label className={FIELD_LABEL}>
              Resumo
              <textarea
                className={`${FIELD} resize-y leading-relaxed`}
                rows={rowsFor(docs.cv.summary)}
                value={docs.cv.summary}
                onChange={(e) => setCv({ summary: e.target.value })}
              />
            </label>
          </Item>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1 text-[13px] font-semibold text-jf-ink-2">Competências</legend>
            {docs.cv.skills.map((s, i) => (
              <Item key={ids.skills[i] ?? `s${i}`} state={cv.flags.skills[i]} onApprove={onApprove}>
                <div className="flex gap-2">
                  <input
                    aria-label={`Competência ${i + 1}`}
                    className={FIELD}
                    value={s}
                    onChange={(e) => setCv({ skills: docs.cv.skills.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  <button
                    type="button"
                    className={BTN_OUTLINE}
                    aria-label={`Remover competência ${i + 1}`}
                    onClick={() => {
                      setIds((c) => ({ ...c, skills: c.skills.filter((_, j) => j !== i) }));
                      setCv({ skills: docs.cv.skills.filter((_, j) => j !== i) });
                    }}
                  >
                    Remover
                  </button>
                </div>
              </Item>
            ))}
          </fieldset>

          {docs.cv.experiences.map((x, xi) => {
            const occurrence = occurrences.get(x.expId) ?? 0;
            occurrences.set(x.expId, occurrence + 1);
            const exp = cv.experiences.find((e) => e.expId === x.expId && e.occurrence === occurrence);
            if (!exp) {
              return (
                <p key={xi} role="note" className="rounded-xl border border-jf-line-strong p-3 text-sm text-jf-ink-2">
                  Uma experiência gerada não existe no seu perfil e foi removida do CV.
                </p>
              );
            }
            const setBullets = (bullets: typeof x.bullets) =>
              setCv({ experiences: docs.cv.experiences.map((e, j) => (j === xi ? { ...e, bullets } : e)) });
            return (
              <fieldset key={xi} className="flex flex-col gap-2.5">
                <legend className="mb-1 text-sm font-semibold">
                  {exp.role} · {exp.company} <span className="font-normal text-jf-ink-3">({exp.period})</span>
                </legend>
                {x.bullets.map((b, bi) => {
                  const state = exp.bullets[bi];
                  return (
                    <Item
                      key={ids.bullets[xi]?.[bi] ?? `b${bi}`}
                      state={state}
                      approvable={state.violations.some((v) => v.key === state.key) && state.violations.every((v) => v.key === state.key)}
                      onApprove={onApprove}
                    >
                      <div className="flex gap-2">
                        <textarea
                          aria-label={`Bullet ${bi + 1} de ${exp.company}`}
                          className={`${FIELD} resize-y leading-relaxed`}
                          rows={rowsFor(b.text)}
                          value={b.text}
                          onChange={(e) => setBullets(x.bullets.map((y, j) => (j === bi ? { ...y, text: e.target.value } : y)))}
                        />
                        <button
                          type="button"
                          className={`${BTN_OUTLINE} self-start`}
                          aria-label={`Remover bullet ${bi + 1} de ${exp.company}`}
                          onClick={() => {
                            setIds((c) => ({ ...c, bullets: c.bullets.map((l, k) => (k === xi ? l.filter((_, j) => j !== bi) : l)) }));
                            setBullets(x.bullets.filter((_, j) => j !== bi));
                          }}
                        >
                          Remover
                        </button>
                      </div>
                    </Item>
                  );
                })}
              </fieldset>
            );
          })}
          <p className="text-[13px] text-jf-ink-3">
            Empresa, cargo e datas vêm do seu perfil e não são editáveis aqui.
          </p>
        </div>
      )}
    </section>
  );
}
