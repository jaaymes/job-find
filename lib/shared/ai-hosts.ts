/**
 * Origens dos provedores de IA liberadas no `connect-src` da CSP (D-15/D-17).
 * Lista única: o `next.config.ts` e o registro de provedores (Tarefa 23) leem daqui.
 * Só origens (esquema + host[+porta]). Liberar `https:` inteiro exige nova decisão.
 */
export const AI_CSP_HOSTS: string[] = [
  "https://openrouter.ai",
  "https://api.openai.com",
  "https://api.anthropic.com",
  "https://generativelanguage.googleapis.com",
  "https://api.deepseek.com",
  "https://api.mistral.ai",
  "https://api.groq.com",
  "https://api.x.ai",
  "https://api.together.xyz",
  "https://api.fireworks.ai",
  "https://api.cerebras.ai",
  "https://router.huggingface.co",
  "https://ai-gateway.vercel.sh",
  // IA local (Ollama/LM Studio), loopback em qualquer porta.
  "http://127.0.0.1:*",
  "http://localhost:*",
];
