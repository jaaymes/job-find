import type { AiSettings } from "@/lib/client/ai/settings";
import type { LocalRoute } from "@/components/ui/hard-link";
import type { Profile } from "@/lib/shared/schemas/profile";

export type SetupProgress = { aiReady: boolean; cvReady: boolean; step: 1 | 2 | 3 }; // step 3 = pronto

/** IA pronta = ao menos um provedor conectado; currículo pronto = há perfil salvo. */
export function getSetupProgress(ai: AiSettings | null, profile: Profile | null): SetupProgress {
  const aiReady = ai !== null && Object.keys(ai.providers).length > 0;
  const cvReady = profile !== null;
  const step = !aiReady ? 1 : !cvReady ? 2 : 3;
  return { aiReady, cvReady, step };
}

const RETURN_PATH = /^\/(vagas|gerador)\/\d+$/;

/** Só aceita `/vagas/<n>` ou `/gerador/<n>`: evita open redirect pelo parâmetro `voltar`. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  return typeof raw === "string" && RETURN_PATH.test(raw) ? raw : null;
}

/** Acrescenta `?voltar=` (já validado) à rota local; sem retorno, devolve a rota intacta. */
export function withReturn(href: LocalRoute, returnTo: string | null): string {
  const safe = safeReturnPath(returnTo);
  return safe ? `${href}?voltar=${encodeURIComponent(safe)}` : href;
}
