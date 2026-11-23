import { AiError } from "@/lib/client/ai/errors";
import { ExtractError } from "@/lib/client/extract/errors";

export const SCANNED_MESSAGE = "Não consegui ler o texto deste PDF; cole o texto do currículo";

export type Failure = { text: string; retryable: boolean };

export function extractFailure(e: ExtractError): string {
  switch (e.code) {
    case "too_large":
      return "O arquivo tem mais de 5 MB. Escolha um arquivo menor.";
    case "bad_type":
      return "Use um arquivo PDF ou DOCX.";
    case "too_many_pages":
      return "O PDF tem mais de 10 páginas. Envie só as páginas principais ou cole o texto.";
    case "timeout":
      return "A leitura do arquivo demorou demais. Tente de novo ou cole o texto do currículo.";
    case "empty":
      return "O arquivo não tem texto. Cole o texto do currículo.";
    case "failed":
    default:
      return "Não foi possível processar o arquivo neste navegador. Cole o texto do currículo.";
  }
}

export function aiFailure(e: AiError): string {
  switch (e.code) {
    case "invalid_key":
      return "Chave inválida. Confira a chave em Configurações.";
    case "no_credit":
      return "Sem créditos nesta conta do provedor.";
    case "budget":
      return "O limite de gasto da chave foi atingido.";
    case "rate_limit":
      return "Limite de uso atingido. Tente de novo em instantes.";
    case "timeout":
      return "A IA demorou demais para responder.";
    case "unavailable":
      return "Não foi possível falar com o provedor. Verifique a conexão.";
    case "no_provider":
      return "Conecte uma IA em Configurações para ler o currículo.";
    case "truncated":
      return "A resposta da IA foi cortada. Tente de novo ou use um currículo mais curto.";
    case "invalid_output":
      return "A IA devolveu um resultado que não consegui usar. Tente de novo.";
    case "blocked_by_privacy":
      return "Aceite o aviso de privacidade deste provedor em Configurações para usá-lo.";
    case "local_blocked":
      return "Não foi possível acessar a IA local. O servidor precisa liberar esta página (CORS).";
    default:
      return "Não foi possível estruturar o currículo.";
  }
}

export function toFailure(e: unknown): Failure {
  if (e instanceof ExtractError) return { text: extractFailure(e), retryable: false };
  if (e instanceof AiError) return { text: aiFailure(e), retryable: e.retryable };
  return { text: "Algo deu errado ao ler o currículo. Tente de novo.", retryable: true };
}
