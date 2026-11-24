import type { AiError } from "@/lib/client/ai/errors";

export type AiFailureContext = {
  /** Texto do erro `no_provider`, que depende do que a tela está fazendo. */
  noProvider: string;
  /** Texto de `truncated` (o que fazer para a resposta caber). */
  truncated: string;
  /** Texto para erros sem mensagem própria. */
  fallback: string;
};

/** Mensagens em pt-BR dos erros da camada de IA, compartilhadas pelas telas que chamam a IA. */
export function aiFailure(e: AiError, ctx: AiFailureContext): string {
  switch (e.code) {
    case "invalid_key":
      return "Chave inválida. Confira a chave em Configurações.";
    case "no_credit":
      return "Sem crédito, recarregue";
    case "budget":
      return "O limite de gasto da chave foi atingido.";
    case "rate_limit":
      return "Limite de uso atingido. Tente de novo em instantes.";
    case "timeout":
      return "A IA demorou demais para responder.";
    case "unavailable":
      return "Não foi possível falar com o provedor. Verifique a conexão.";
    case "no_provider":
      return ctx.noProvider;
    case "truncated":
      return ctx.truncated;
    case "invalid_output":
      return "A IA devolveu um resultado que não consegui usar. Tente de novo.";
    case "blocked_by_privacy":
      if (e.meta?.reason === "free_models") {
        return "Para usar os modelos gratuitos do OpenRouter, aceite o aviso deles no card do OpenRouter em Configurações.";
      }
      return "Aceite o aviso de privacidade deste provedor em Configurações para usá-lo.";
    case "data_policy":
      return "Nenhum provedor do OpenRouter atende este modelo com a sua política de dados. Em modelos gratuitos, libere-os em openrouter.ai/settings/privacy. Nos pagos, escolha outro modelo ou desmarque 'Pedir ao OpenRouter que use só provedores que não guardam meus dados' em Configurações.";
    case "local_blocked":
      return "Não foi possível acessar a IA local. O servidor precisa liberar esta página (CORS).";
    default:
      return ctx.fallback;
  }
}
