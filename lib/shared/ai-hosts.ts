/**
 * Origens dos provedores de IA liberadas no `connect-src` da CSP (D-15/D-17).
 * Lista literal e isomórfica lida pelo `next.config.ts` e pelo `proxy.ts`. O teste do registro
 * (`tests/unit/client/ai/providers.test.ts`) garante que ela é igual aos `cspHosts` de `PROVIDERS`.
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
