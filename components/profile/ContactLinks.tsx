"use client";

import { useId, useState, type FormEvent } from "react";
import { BTN_OUTLINE, FIELD, FIELD_LABEL } from "./styles";

/** Aceita só http(s); devolve a URL normalizada ou null. */
export function parseHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function ContactLinks({ links, onChange }: { links: string[]; onChange: (l: string[]) => void }) {
  const errId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  function add(e: FormEvent) {
    e.preventDefault();
    const url = parseHttpUrl(draft);
    if (!url) {
      setError(true);
      return;
    }
    if (!links.includes(url)) onChange([...links, url]);
    setDraft("");
    setError(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold">Links</h3>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-jf-ink-2" aria-label="Links do perfil">
          {links.map((l) => (
            <li key={l} className="flex items-center gap-2">
              <span className="min-w-0 break-all">{l}</span>
              <button
                type="button"
                className={`${BTN_OUTLINE} min-w-11`}
                aria-label={`Remover link ${l}`}
                onClick={() => onChange(links.filter((x) => x !== l))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2" noValidate>
        <label className={`${FIELD_LABEL} min-w-48 flex-1`}>
          Novo link (http ou https)
          <input
            className={FIELD}
            value={draft}
            inputMode="url"
            autoComplete="off"
            aria-invalid={error || undefined}
            aria-describedby={error ? errId : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(false);
            }}
          />
        </label>
        <button type="submit" className={BTN_OUTLINE}>
          Adicionar link
        </button>
      </form>
      {error && (
        <p id={errId} role="alert" className="text-[13px] text-jf-danger-fg">
          Use um endereço http ou https válido.
        </p>
      )}
    </div>
  );
}
