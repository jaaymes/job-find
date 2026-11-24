import "server-only";
import type { ConnectorContext } from "@/lib/server/sources/types";

const CONCURRENCY = 5;

/**
 * Toda a janela do rodízio falhou. O cursor já avançou (`ctx.setCursor`) e o runner o persiste
 * mesmo com o erro, para a próxima coleta seguir para os boards seguintes em vez de repetir a
 * mesma janela quebrada para sempre.
 */
export class AllBoardsFailedError extends Error {
  constructor(label: string) {
    super(`${label}: todos os boards falharam`);
    this.name = "AllBoardsFailedError";
  }
}
/** Margem antes do prazo da fonte em que deixamos de agendar novos boards. */
export const DEADLINE_MARGIN_MS = 5_000;

/**
 * Coleta uma lista curada de boards em rodízio, com no máximo 5 requisições simultâneas.
 *
 * - O `ctx.cursor` guarda o índice do próximo board; a coleta começa nele e dá a volta na lista.
 * - Perto de `ctx.deadlineAt` (margem de 5 s) para de agendar boards e grava onde parou, então a
 *   próxima execução continua dali. Sempre tenta pelo menos 1 board.
 * - Um board fora do ar (404, rede, formato) é pulado e reportado via `ctx.reportPartial`; se todos
 *   os tentados falharem, lança, para o runner distinguir fonte quebrada de coleta vazia.
 * - Só entram no escopo de expiração (`ctx.reportScope`) os boards lidos sem erro e com vagas.
 * - Um abort de `ctx.signal` para o agendamento e é relançado, nunca contado como falha de board.
 */
export async function* fetchBoardsPooled(
  ctx: ConnectorContext,
  label: string,
  boards: readonly string[],
  fetchBoard: (board: string) => Promise<unknown[]>,
  opts: { scopePrefix?: (board: string) => string } = {},
): AsyncGenerator<unknown> {
  const n = boards.length;
  const scopePrefix = opts.scopePrefix ?? ((b: string) => `${b}:`);
  const parsed = ctx.cursor !== null && /^\d+$/.test(ctx.cursor) ? Number.parseInt(ctx.cursor, 10) : -1;
  const start = parsed >= 0 && parsed < n ? parsed : 0;

  const results: (unknown[] | null)[] = boards.map(() => null);
  let failures = 0;
  let attempted = 0;
  const worker = async () => {
    while (
      attempted < n &&
      !ctx.signal.aborted &&
      (attempted === 0 || Date.now() < ctx.deadlineAt - DEADLINE_MARGIN_MS)
    ) {
      const i = (start + attempted++) % n;
      try {
        results[i] = await fetchBoard(boards[i]!);
      } catch (error) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
        failures++;
        ctx.reportPartial(boards[i]!, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
  ctx.signal.throwIfAborted();
  if (n > 0) ctx.setCursor(String((start + attempted) % n));
  if (attempted > 0 && failures === attempted) throw new AllBoardsFailedError(label);
  const scope: string[] = [];
  for (let k = 0; k < attempted; k++) {
    const i = (start + k) % n;
    const jobs = results[i];
    if (jobs && jobs.length > 0) scope.push(scopePrefix(boards[i]!));
  }
  ctx.reportScope(scope);
  for (let k = 0; k < attempted; k++) yield* results[(start + k) % n] ?? [];
}
