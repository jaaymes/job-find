/**
 * Avaliação da geração de CV (`CV_TAILOR_V1`) em 11 pares fictícios de perfil e vaga (Tarefa 35; o par 11, de perfil
 * abaixo da senioridade da vaga e com ferramentas da vaga fora do perfil, veio na revisão final).
 *
 *   pnpm tsx scripts/eval-ai.ts --provider openrouter            (a chave é pedida sem eco)
 *   pnpm tsx scripts/eval-ai.ts --provider openrouter --key-file ~/segredos/openrouter.key
 *   pnpm tsx scripts/eval-ai.ts --mock                           (modelo falso, sem rede nem chave)
 *   pnpm tsx scripts/eval-ai.ts --mock --out ~/eval-cv           (grava o CV e a carta de cada par em texto)
 *
 * A chave nunca vem por argumento (iria para o histórico do shell e para o `ps`) nem por variável de ambiente,
 * e nunca é impressa.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/client/ai/providers";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";
import { pickLanguage } from "@/lib/client/ai/prompts/cv.tailor.v1";
import {
  abortReason,
  evaluatePair,
  loadPairs,
  renderReport,
  summarize,
  writeOutputs,
  type Aborted,
  type PairResult,
  type Price,
} from "./eval-ai/core";
import { assertOutsideRepoOrIgnored, readHiddenLine, readKeyFile } from "./eval-ai/key";

const HELP = `Uso: pnpm tsx scripts/eval-ai.ts [opções]
  --provider <id>    provedor do app (padrão: openrouter): ${PROVIDER_IDS.join(", ")}
  --model <id>       modelo (padrão: o modelo de CV do provedor em providers.ts)
  --key-file <path>  arquivo com a chave (fora do repositório ou ignorado pelo git); sem ele, a chave é pedida sem eco
  --accept-privacy   aceita o aviso de privacidade do provedor, quando houver
  --out <dir>        grava o CV e a carta (texto montado) de cada par em <dir>, fora do repositório ou ignorado
                     pelo git; sem ele, nada é gravado
  --mock             usa um modelo falso (valida o encanamento, não avalia modelo algum)
  --help`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

/** `DOMParser` não existe no Node; o prompt o usa para converter o HTML da vaga em texto. */
async function ensureDomParser() {
  if (typeof globalThis.DOMParser !== "undefined") return;
  const { JSDOM } = await import("jsdom");
  globalThis.DOMParser = new JSDOM("").window.DOMParser as typeof DOMParser;
}

async function lookupPrice(id: ProviderId, apiKey: string | undefined, modelId: string): Promise<Price | null> {
  try {
    const models = await PROVIDERS[id].listModels({ apiKey });
    const m = models.find((x) => x.id === modelId);
    return m?.priceIn !== undefined && m.priceOut !== undefined ? { priceIn: m.priceIn, priceOut: m.priceOut } : null;
  } catch {
    return null;
  }
}

async function main() {
  let values;
  try {
    values = parseArgs({
      options: {
        provider: { type: "string", default: "openrouter" },
        model: { type: "string" },
        "key-file": { type: "string" },
        "accept-privacy": { type: "boolean", default: false },
        out: { type: "string" },
        mock: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch {
    // Não repete a mensagem do parseArgs: ela pode ecoar o valor de um argumento digitado por engano (a chave).
    fail(`Argumento inválido. A chave não é aceita por argumento.\n\n${HELP}`);
  }
  if (values.help) return console.log(HELP);
  if (!(PROVIDER_IDS as readonly string[]).includes(values.provider)) fail(`Provedor desconhecido.\n\n${HELP}`);
  const providerId = values.provider as ProviderId;
  const def = PROVIDERS[providerId];
  const modelId = values.model ?? def.defaultModels.cv;

  let outDir: string | undefined;
  if (values.out) {
    try {
      outDir = assertOutsideRepoOrIgnored(values.out, { repoRoot: process.cwd() }, "o diretório do --out");
    } catch (e) {
      fail(e instanceof Error ? e.message : "diretório do --out inválido");
    }
  }

  await ensureDomParser();
  const pairs = await loadPairs(resolve(import.meta.dirname, "../tests/fixtures/ai/pairs"));

  let settings: AiSettings = defaultAiSettings();
  let apiKey: string | undefined;
  let price: Price | null = null;
  let resolverFor: ((i: number) => NonNullable<Parameters<typeof evaluatePair>[1]["resolveModel"]>) | undefined;

  if (values.mock) {
    const { MOCK_SCENARIOS, mockResolverFor } = await import("./eval-ai/mock");
    resolverFor = (i) => mockResolverFor(pairs[i], pickLanguage(pairs[i].job), MOCK_SCENARIOS[pairs[i].id] ?? "clean");
    console.log("MODO MOCK: modelo falso, valida o encanamento do script; não é uma avaliação de modelo.\n");
  } else {
    if (def.privacyNote && !values["accept-privacy"]) {
      fail(`Aviso de privacidade de ${def.label}: ${def.privacyNote}\nPara continuar, rode de novo com --accept-privacy.`);
    }
    if (def.auth.kind !== "none") {
      try {
        apiKey = values["key-file"]
          ? await readKeyFile(values["key-file"], { repoRoot: process.cwd() })
          : await readHiddenLine(`Chave de ${def.label} (não aparece ao digitar): `);
      } catch (e) {
        fail(e instanceof Error ? e.message : "não foi possível obter a chave");
      }
      if (!apiKey) fail("Chave vazia.");
    }
    settings = {
      ...settings,
      providers: {
        [providerId]: {
          addedAt: new Date().toISOString(),
          source: "paste",
          ...(apiKey ? { key: apiKey } : {}),
          ...(def.id === "local" ? { baseURL: def.baseURL } : {}),
          ...(def.privacyNote ? { privacyAccepted: true } : {}),
        },
      },
      tasks: { extract: null, analyze: null, cv: { provider: providerId, model: modelId } },
    };
    price = await lookupPrice(providerId, apiKey, modelId);
    console.log(`Provedor: ${def.label} | modelo: ${modelId} | ${pairs.length} pares\n`);
  }

  const results: PairResult[] = [];
  let aborted: Aborted | null = null;
  for (const [i, pair] of pairs.entries()) {
    process.stderr.write(`par ${pair.id}... `);
    const r = await evaluatePair(pair, { settings, resolveModel: resolverFor?.(i) });
    process.stderr.write(`${r.validJson ? "ok" : "falhou"}\n`);
    results.push(r);
    // Chave inválida, sem crédito ou sem rede: os próximos pares falhariam igual.
    const reason = abortReason(r);
    if (reason) {
      aborted = { after: pair.id, reason, skipped: pairs.length - i - 1 };
      break;
    }
  }

  const summary = summarize(results, price, undefined, aborted);
  console.log(`\n${renderReport(results, price, summary, aborted)}`);
  if (outDir) {
    const written = await writeOutputs(outDir, pairs, results);
    console.log(`\nTextos gerados: ${written.length} arquivo(s) em ${outDir}`);
  }
  process.exitCode = summary.pass ? 0 : 1;
}

main().catch(() => {
  // Sem imprimir o erro bruto: ele poderia carregar cabeçalhos ou URLs do provedor.
  console.error("Falha inesperada na avaliação.");
  process.exit(2);
});
