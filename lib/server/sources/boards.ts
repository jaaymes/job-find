import "server-only";
import type { ConnectorContext } from "@/lib/server/sources/types";

const CONCURRENCY = 3;

/**
 * Coleta uma lista curada de boards com no máximo 3 requisições simultâneas.
 * Um board fora do ar (404, rede, formato) é pulado e reportado via `ctx.reportPartial` (o runner
 * registra e não conta coleta perdida nessa execução); se todos falharem, lança, para o runner
 * distinguir fonte quebrada de coleta vazia. Um abort de `ctx.signal` para o agendamento e é
 * relançado, nunca contado como falha de board.
 */
export async function* fetchBoardsPooled(
  ctx: ConnectorContext,
  label: string,
  boards: readonly string[],
  fetchBoard: (board: string) => Promise<unknown[]>,
): AsyncGenerator<unknown> {
  const results: unknown[][] = boards.map(() => []);
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (next < boards.length && !ctx.signal.aborted) {
      const i = next++;
      try {
        results[i] = await fetchBoard(boards[i]!);
      } catch (error) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
        failures++;
        ctx.reportPartial(boards[i]!, error);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  ctx.signal.throwIfAborted();
  if (failures === boards.length) throw new Error(`${label}: todos os boards falharam`);
  for (const jobs of results) yield* jobs;
}
