import "client-only";

import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "./providers";

export type KeyCheck = { warning: string | null; suggest: ProviderId | null };

const CLEAN: KeyCheck = { warning: null, suggest: null };

/** Provedores com prefixo conhecido, do prefixo mais longo ao mais curto (`sk-ant-`/`sk-or-` vencem `sk-`). */
const BY_PREFIX = PROVIDER_IDS.flatMap((id) => {
  const hint = PROVIDERS[id].keyHint;
  return hint ? [{ id, prefix: hint.prefix }] : [];
}).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Confere, só pelo prefixo, se a chave colada parece ser do provedor escolhido. Nunca bloqueia e nunca repete a
 * chave no aviso. Provedor sem `keyHint` nunca avisa.
 */
export function checkKey(id: ProviderId, key: string): KeyCheck {
  const own = PROVIDERS[id].keyHint;
  const k = key.trim();
  // Campo vazio ou a pessoa ainda digitando o próprio prefixo: cedo demais para avisar.
  if (!own || k === "" || own.prefix.startsWith(k)) return CLEAN;
  const owner = BY_PREFIX.find((p) => k.startsWith(p.prefix));
  if (owner?.id === id) return CLEAN;
  if (owner) return { warning: `Parece uma chave do(a) ${PROVIDERS[owner.id].label}.`, suggest: owner.id };
  return { warning: `Essa chave não parece ser do(a) ${PROVIDERS[id].label}. Confira se copiou a chave certa.`, suggest: null };
}
