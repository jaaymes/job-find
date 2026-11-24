import { registerHooks } from "node:module";

/**
 * `server-only` só existe dentro do bundler do Next; fora dele (tsx) a importação falha.
 * Este shim resolve o pacote para um módulo vazio, como os aliases de teste do vitest.
 * Precisa ser importado antes de qualquer módulo de `lib/server`.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export default {}", format: "module", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
