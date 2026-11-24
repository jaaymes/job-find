import { z } from "zod";

// A CSP das rotas (local) não tem 'unsafe-eval'. O Zod 4 testa `new Function` na criação do primeiro schema de objeto
// e isso gera uma violação de CSP; desligar o JIT aqui, no mesmo módulo que reexporta `z`, garante a ordem.
// No servidor, só desliga o caminho rápido (sem efeito funcional).
z.config({ jitless: true });

export { z };
export type { ZodType } from "zod";
