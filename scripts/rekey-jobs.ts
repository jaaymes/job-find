/**
 * Recálculo de `dedupe_key` e `url_canonical` das vagas ativas com a fórmula atual, fundindo as que colidirem (D-05).
 *
 *   pnpm db:rekey              (simulação: só imprime o que mudaria, nada é gravado)
 *   pnpm db:rekey --apply      (grava numa transação única)
 *
 * Usa a `DATABASE_URL` do ambiente. Antes de ler, pega o lock de todas as fontes (TTL de 5 min); se alguma estiver
 * coletando, libera as que pegou e aborta com código 1. No fim, libera só os locks que pegou: soltar os demais liberaria
 * o lock de uma coleta em andamento, que pertence a outro processo. As vagas de empresa vazia ou desconhecida ficam de
 * fora (a chave delas vem do `external_id`), e nenhuma vaga recalculada passa a usar a URL de uma delas: nesse caso a
 * URL gravada é mantida. É idempotente: rodar de novo não muda nada.
 */
import "./discover-boards/server-only-shim";
import { parseArgs } from "node:util";
import type { SourceId } from "@/lib/shared/types/job";

// Depois do shim: estes módulos de `lib/server` carregam `server-only`.
const { getPoolDb } = await import("@/lib/server/db/client");
const { acquireLock, releaseLock } = await import("@/lib/server/collect/lock");
const { applyRekey, findMixedTitleGroups, findReservedConflicts, loadRekeyRows, loadReservedUrls, planRekey } =
  await import("@/lib/server/jobs/rekey");
const { SOURCE_IDS } = await import("@/lib/shared/sources");

const LOCK_TTL_MS = 300_000;
const MAX_SAMPLES = 20;

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
  const db = getPoolDb();
  const locked: SourceId[] = [];
  try {
    for (const id of SOURCE_IDS) {
      if (!(await acquireLock(db, id, LOCK_TTL_MS))) {
        console.error(`Coleta em andamento na fonte ${id}; tente de novo em alguns minutos.`);
        process.exitCode = 1;
        return;
      }
      locked.push(id);
    }

    const rows = await loadRekeyRows(db);
    const reservedUrls = await loadReservedUrls(db);
    const groups = planRekey(rows, reservedUrls);
    const toMerge = groups.filter((g) => g.ids.length > 1);
    const byId = new Map(rows.map((r) => [r.id, r]));

    console.log(`Vagas lidas: ${rows.length}`);
    console.log(`Grupos a fundir: ${toMerge.length}`);
    console.log(`Vagas que expiram: ${toMerge.reduce((n, g) => n + g.ids.length - 1, 0)}`);
    console.log(`Vagas regravadas (sobreviventes e sem fusão): ${groups.length}`);
    console.log(`URLs mantidas por conflito com vagas sem empresa: ${findReservedConflicts(rows, reservedUrls).length}`);
    const printGroup = (group: (typeof groups)[number]) => {
      console.log(`- Grupo com ${group.ids.length} vagas:`);
      for (const id of group.ids) {
        const row = byId.get(id)!;
        console.log(`    #${id} ${row.company} — ${row.title}`);
      }
    };
    if (toMerge.length > 0) {
      console.log(`Amostras (até ${MAX_SAMPLES} grupos):`);
      for (const group of toMerge.slice(0, MAX_SAMPLES)) printGroup(group);
    }
    // Todos, sem limite: são os candidatos a falso positivo (RQ-02).
    const mixedTitles = findMixedTitleGroups(groups, rows);
    console.log(`Grupos com títulos diferentes (confira antes do --apply): ${mixedTitles.length}`);
    for (const group of mixedTitles) printGroup(group);

    if (!values.apply) {
      console.log("Simulação: nada foi gravado. Rode com --apply para aplicar.");
      return;
    }
    const result = await db.transaction((tx) => applyRekey(tx, groups, new Date()));
    console.log(`Aplicado: ${result.merged} vagas expiradas na fusão; ${result.rekeyed} vagas regravadas (sobreviventes e sem fusão).`);
  } finally {
    for (const id of locked) await releaseLock(db, id);
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
