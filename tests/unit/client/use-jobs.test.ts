import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobsInfiniteOptions, type JobsPage } from "@/lib/client/jobs/use-jobs";

function page(over: Partial<JobsPage>): JobsPage {
  return { items: [], nextCursor: null, lastCollectedAt: null, ...over };
}

function stubFetch(pages: JobsPage[]) {
  const mock = vi.fn(async () => Response.json(pages.shift()));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("useJobs (opções da query infinita)", () => {
  it("monta a URL canônica e passa o cursor da página anterior", async () => {
    const fetchMock = stubFetch([
      page({ nextCursor: "CUR1", counts: { all: 2, remote: 1, hybrid: 1, onsite: 0 } }),
      page({ nextCursor: null }),
    ]);
    const client = new QueryClient();
    const options = jobsInfiniteOptions({ workMode: "remote", stacks: ["vue", "react"], q: "dev" });

    const result = await client.fetchInfiniteQuery({ ...options, pages: 2 });

    expect(result.pages).toHaveLength(2);
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toBe("/api/jobs?q=dev&stacks=react%2Cvue&workMode=remote");
    expect(urls[1]).toBe("/api/jobs?cursor=CUR1&q=dev&stacks=react%2Cvue&workMode=remote");
  });

  it("não gasta uma segunda requisição quando não há próxima página", async () => {
    const fetchMock = stubFetch([page({ nextCursor: null })]);
    const client = new QueryClient();
    await client.fetchInfiniteQuery({ ...jobsInfiniteOptions({}), pages: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(["/api/jobs", expect.anything()]);
  });

  it("rejeita com a mensagem da API quando a resposta não é 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "invalid_query", message: "Parâmetro inválido: q" } }, { status: 400 })),
    );
    const client = new QueryClient();
    await expect(client.fetchInfiniteQuery(jobsInfiniteOptions({}))).rejects.toThrow("Parâmetro inválido: q");
  });
});
