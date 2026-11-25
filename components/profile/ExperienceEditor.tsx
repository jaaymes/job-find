"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import { MAX_HIGHLIGHTS, type Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import { AssistantDialog } from "./assistant/AssistantDialog";
import { AssistButton } from "./assistant/AssistButton";
import { maxSeq, nextSeq } from "./ids";

const BULLET_ID = /\.b(\d+)$/;

type Experience = Profile["experiences"][number];

type Props = {
  /** Rascunho do perfil, usado como contexto do assistente de IA. */
  profile: Profile;
  experiences: Experience[];
  onChange: (experiences: Experience[]) => void;
  /** Ids `exp_N.bM` dos bullets destacados (estrela). */
  highlights: string[];
  onHighlightsChange: (ids: string[]) => void;
  /** Pedido externo para abrir o assistente numa experiência (ex.: "Corrigir" da revisão); `n` distingue pedidos repetidos. */
  assistRequest?: { expId: string; n: number } | null;
};

function period(e: Experience): string {
  const start = e.startDate ?? "?";
  return `${start} – ${e.endDate ?? "atual"}`;
}

function Row({
  exp,
  onChange,
  onRemove,
  startOpen,
  highlights,
  activeCount,
  onHighlightsChange,
  seenFor,
  onAssist,
}: {
  exp: Experience;
  onChange: (e: Experience) => void;
  onRemove: () => void;
  startOpen: boolean;
  highlights: string[];
  /** Destaques que apontam para realizações existentes (em todas as experiências). */
  activeCount: number;
  onHighlightsChange: (ids: string[]) => void;
  /** Maior número de bullet já emitido nesta experiência (compartilhado com as inserções do assistente). */
  seenFor: (e: Experience) => MutableRefObject<number>;
  onAssist: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const set = (patch: Partial<Experience>) => onChange({ ...exp, ...patch });
  const atMax = activeCount >= MAX_HIGHLIGHTS;
  const title = [exp.title, exp.company].filter(Boolean).join(" · ") || "Nova experiência";

  return (
    <li className={`${CARD} flex flex-col gap-2 rounded-xl p-4`}>
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{title}</strong>
        <span className="text-sm text-jf-ink-3">{period(exp)}</span>
      </div>
      {!open && (
        <ul className="list-disc pl-[18px] text-sm leading-relaxed text-jf-ink-2">
          {exp.bullets.map((b) => (
            <li key={b.id}>{b.text}</li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={FIELD_LABEL}>
              Cargo
              <input className={FIELD} value={exp.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className={FIELD_LABEL}>
              Empresa
              <input className={FIELD} value={exp.company} onChange={(e) => set({ company: e.target.value })} />
            </label>
            <label className={FIELD_LABEL}>
              Início (AAAA-MM)
              <input
                className={FIELD}
                value={exp.startDate ?? ""}
                onChange={(e) => set({ startDate: e.target.value || null })}
              />
            </label>
            <label className={FIELD_LABEL}>
              Fim (AAAA-MM; vazio = atual)
              <input className={FIELD} value={exp.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-jf-ink-2">Realizações</legend>
            {exp.bullets.map((b, i) => (
              <div key={b.id} className="flex items-start gap-2">
                <textarea
                  aria-label={`Realização ${i + 1}`}
                  rows={2}
                  className={FIELD}
                  value={b.text}
                  onChange={(e) =>
                    set({ bullets: exp.bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)) })
                  }
                />
                <button
                  type="button"
                  aria-pressed={highlights.includes(b.id)}
                  aria-label="Destacar no CV"
                  title={atMax && !highlights.includes(b.id) ? `Máximo de ${MAX_HIGHLIGHTS} destaques` : "Destacar no CV"}
                  disabled={atMax && !highlights.includes(b.id)}
                  className={`${BTN_OUTLINE} min-w-11 aria-pressed:border-jf-brand aria-pressed:bg-jf-chip aria-pressed:text-jf-brand-dark`}
                  onClick={() =>
                    onHighlightsChange(
                      highlights.includes(b.id) ? highlights.filter((h) => h !== b.id) : [...highlights, b.id],
                    )
                  }
                >
                  <span aria-hidden="true">{highlights.includes(b.id) ? "★" : "☆"}</span>
                </button>
                <button
                  type="button"
                  className={`${BTN_OUTLINE} min-w-11`}
                  aria-label={`Remover realização ${i + 1}`}
                  onClick={() => {
                    set({ bullets: exp.bullets.filter((x) => x.id !== b.id) });
                    if (highlights.includes(b.id)) onHighlightsChange(highlights.filter((h) => h !== b.id));
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${BTN_OUTLINE} w-fit`}
              onClick={() => {
                const n = nextSeq(seenFor(exp), exp.bullets.map((b) => b.id), BULLET_ID);
                set({ bullets: [...exp.bullets, { id: `${exp.id}.b${n}`, text: "" }] });
              }}
            >
              + Realização
            </button>
            <AssistButton empty={exp.bullets.every((b) => b.text.trim() === "")} onClick={onAssist} />
            </div>
          </fieldset>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-jf-brand outline-none hover:bg-jf-brand-soft focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Concluir edição" : "Editar experiência"}
          <span className="sr-only"> {title}</span>
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-jf-danger-fg outline-none hover:bg-jf-danger-bg focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={onRemove}
        >
          Remover experiência<span className="sr-only"> {title}</span>
        </button>
      </div>
    </li>
  );
}

export function ExperienceEditor({ profile, experiences, onChange, highlights, onHighlightsChange, assistRequest = null }: Props) {
  const [newId, setNewId] = useState<string | null>(null);
  const [assistId, setAssistId] = useState<string | null>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [handled, setHandled] = useState(assistRequest?.n ?? 0);
  if (assistRequest && assistRequest.n !== handled) {
    setHandled(assistRequest.n);
    setAssistId(assistRequest.expId);
    setAssistOpen(true);
  }
  const seenBullets = useRef(new Map<string, MutableRefObject<number>>());
  const seenFor = (e: Experience) => {
    let ref = seenBullets.current.get(e.id);
    if (!ref) seenBullets.current.set(e.id, (ref = { current: maxSeq(e.bullets.map((b) => b.id), BULLET_ID) }));
    return ref;
  };
  // O desfazer roda até 8 s depois: precisa ler o estado atual, não o da renderização que o criou.
  const latest = useRef({ experiences, highlights, onChange, onHighlightsChange });
  // Registra o maior id visto a cada renderização, antes de qualquer remoção: `seenFor` lazy no clique já veria só o que sobrou.
  useEffect(() => {
    for (const e of experiences) {
      const ref = seenFor(e);
      ref.current = Math.max(ref.current, maxSeq(e.bullets.map((b) => b.id), BULLET_ID));
    }
  });
  useEffect(() => {
    latest.current = { experiences, highlights, onChange, onHighlightsChange };
  });
  const assistExp = experiences.find((e) => e.id === assistId);

  // Só altera o rascunho: o perfil salvo só muda em "Salvar perfil".
  function insertBullets(expId: string, d: Draft) {
    const cur = latest.current;
    const exp = cur.experiences.find((e) => e.id === expId);
    if (!exp || d.bullets === null) return;
    const previous = { bullets: exp.bullets, highlights: cur.highlights };
    const oldIds = new Set(exp.bullets.map((b) => b.id));
    // Ids novos: nunca reaproveitam os existentes nem os já removidos (`seen` guarda o maior emitido).
    const seen = seenFor(exp);
    const bullets = d.bullets.map((text) => ({ id: `${exp.id}.b${nextSeq(seen, exp.bullets.map((b) => b.id), BULLET_ID)}`, text }));
    const newIds = new Set(bullets.map((b) => b.id));
    cur.onChange(cur.experiences.map((e) => (e.id === expId ? { ...e, bullets } : e)));
    if (cur.highlights.some((h) => oldIds.has(h))) cur.onHighlightsChange(cur.highlights.filter((h) => !oldIds.has(h)));
    toast("Texto inserido", {
      duration: 8000,
      action: {
        label: "Desfazer",
        onClick: () => {
          const now = latest.current;
          if (!now.experiences.some((e) => e.id === expId)) return;
          now.onChange(now.experiences.map((e) => (e.id === expId ? { ...e, bullets: previous.bullets } : e)));
          const restored = previous.highlights.filter((h) => oldIds.has(h));
          const kept = now.highlights.filter((h) => !newIds.has(h) && !restored.includes(h));
          now.onHighlightsChange([...kept, ...restored]);
        },
      },
    });
  }
  const seenExp = useRef(maxSeq(experiences.map((e) => e.id), /^exp_(\d+)$/));
  const existingIds = new Set(experiences.flatMap((e) => e.bullets.map((b) => b.id)));
  const activeHighlights = highlights.filter((h) => existingIds.has(h));

  function add() {
    // Ids já usados nunca são reaproveitados (análises e CVs antigos referenciam `exp_N`).
    const id = `exp_${nextSeq(seenExp, experiences.map((e) => e.id), /^exp_(\d+)$/)}`;
    setNewId(id);
    onChange([...experiences, { id, company: "", title: "", startDate: null, endDate: null, bullets: [] }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Experiências</h3>
        <button type="button" className={BTN_OUTLINE} onClick={add}>
          + Experiência
        </button>
      </div>
      {activeHighlights.length >= MAX_HIGHLIGHTS && (
        <p role="status" className="text-sm text-jf-ink-3">
          Máximo de {MAX_HIGHLIGHTS} destaques
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {experiences.map((e) => (
          <Row
            key={e.id}
            exp={e}
            startOpen={e.id === newId}
            highlights={highlights}
            seenFor={seenFor}
            onAssist={() => {
              setAssistId(e.id);
              setAssistOpen(true);
            }}
            activeCount={activeHighlights.length}
            onHighlightsChange={onHighlightsChange}
            onChange={(x) => onChange(experiences.map((y) => (y.id === e.id ? x : y)))}
            onRemove={() => {
              onChange(experiences.filter((y) => y.id !== e.id));
              const gone = e.bullets.map((b) => b.id);
              if (highlights.some((h) => gone.includes(h))) onHighlightsChange(highlights.filter((h) => !gone.includes(h)));
            }}
          />
        ))}
      </ul>
      <AssistantDialog
        open={assistOpen}
        onOpenChange={setAssistOpen}
        profile={profile}
        target={{ kind: "bullets", expId: assistId ?? "" }}
        current={{ text: null, bullets: (assistExp?.bullets ?? []).map((b) => b.text) }}
        onInsert={(d) => assistId && insertBullets(assistId, d)}
      />
    </div>
  );
}
