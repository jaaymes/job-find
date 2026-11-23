import "client-only";

import { z } from "zod";

// A CSP das rotas (local) não tem 'unsafe-eval': sem isto o Zod 4 testa `new Function` ao validar e gera uma violação de CSP.
z.config({ jitless: true });
