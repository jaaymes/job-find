import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_HOST, GITHUB_REPOS, github } from "@/lib/server/sources/github";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Issue = Record<string, unknown> & { number: number; title: string };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/github");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Issue[];
const fixtures: Record<string, Issue[]> = {
  "frontendbr/vagas": read("frontendbr"),
  "backend-br/vagas": read("backend-br"),
  "react-brasil/vagas": read("react-brasil"),
  "qa-brasil/vagas": read("qa-brasil"),
  "androiddevbr/vagas": read("androiddevbr"),
};

function repoOf(url: URL): string | null {
  const m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(url.pathname);
  return url.origin === "https://api.github.com" ? (m?.[1] ?? null) : null;
}

/** Serve a fixture de cada repositório; só a página 1 tem conteúdo. */
function serve(url: URL): unknown {
  const repo = repoOf(url);
  if (!repo || !fixtures[repo]) return undefined;
  return (url.searchParams.get("page") ?? "1") === "1" ? fixtures[repo] : [];
}

afterEach(() => vi.unstubAllEnvs());

describe("conector GitHub issues", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(github.id).toBe("github");
    expect(github.fullSnapshot).toBe(true);
    expect(github.brazilian).toBe(true);
    expect(github.minIntervalMinutes).toBe(60);
    expect(github.allowedHosts).toEqual([GITHUB_HOST]);
    expect(CONNECTORS.github).toBe(github);
    expect(GITHUB_REPOS).toEqual([
      "frontendbr/vagas", "backend-br/vagas", "react-brasil/vagas", "qa-brasil/vagas", "androiddevbr/vagas",
    ]);
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const raws = await collect(github.fetch(fakeCtx({ serve })));
    const jobs = raws.map(github.normalize).filter((j) => j !== null);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.externalId).toBeTruthy();
      expect(safeUrl(j.url, { allowHttp: true })).not.toBeNull();
      expect(j.url.startsWith("https://github.com/")).toBe(true);
      expect(j.title).toBeTruthy();
      expect(j.descriptionFormat).toBe("markdown");
    }
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(jobs.length);
    expect(github.normalize({ lixo: true })).toBeNull();
  });

  it("consulta só issues abertas de cada repositório da lista", async () => {
    const ctx = fakeCtx({ serve });
    await collect(github.fetch(ctx));
    const urls = ctx.requests.map((r) => new URL(r.url));
    expect(urls.map(repoOf).sort()).toEqual([...GITHUB_REPOS].sort());
    for (const u of urls) {
      expect(u.searchParams.get("state")).toBe("open");
      expect(u.searchParams.get("per_page")).toBe("100");
    }
  });

  it("usa GITHUB_TOKEN como Bearer só quando definido", async () => {
    vi.stubEnv("GITHUB_TOKEN", "token-de-teste");
    const withToken = fakeCtx({ serve });
    await collect(github.fetch(withToken));
    for (const r of withToken.requests) expect(r.headers.Authorization).toBe("Bearer token-de-teste");

    vi.stubEnv("GITHUB_TOKEN", "");
    const without = fakeCtx({ serve });
    await collect(github.fetch(without));
    for (const r of without.requests) expect(r.headers).not.toHaveProperty("Authorization");
  });

  it("pagina até uma página incompleta e respeita o teto de páginas", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `[Remoto] Dev ${i} na X` }));
    const pages: string[] = [];
    const ctx = fakeCtx({
      serve: (url) => {
        if (repoOf(url) !== "frontendbr/vagas") return undefined;
        pages.push(url.searchParams.get("page")!);
        return url.searchParams.get("page") === "2" ? [{ number: 1000, title: "última" }] : full;
      },
    });
    const raws = await collect(github.fetch(ctx));
    expect(pages.slice(0, 2)).toEqual(["1", "2"]);
    expect(raws.filter((r) => (r as { repo: string }).repo === "frontendbr/vagas")).toHaveLength(101);

    const endless = fakeCtx({ serve: (url) => (repoOf(url) === "frontendbr/vagas" ? full : undefined) });
    await collect(github.fetch(endless));
    const forRepo = endless.requests.filter((r) => repoOf(new URL(r.url)) === "frontendbr/vagas");
    expect(forRepo.length).toBeLessThanOrEqual(5);
  });

  it("ignora pull requests", async () => {
    const mixed = [
      { number: 1, title: "[Remoto] Dev Backend na ACME", html_url: "https://github.com/backend-br/vagas/issues/1", labels: [] },
      { number: 2, title: "[Remoto] PR de vaga", html_url: "https://github.com/backend-br/vagas/pull/2", labels: [], pull_request: { url: "x" } },
    ];
    const ctx = fakeCtx({ serve: (url) => (repoOf(url) === "backend-br/vagas" ? mixed : undefined) });
    const raws = await collect(github.fetch(ctx));
    expect(raws).toHaveLength(1);
    expect(github.normalize({ ...mixed[1]!, repo: "backend-br/vagas" })).toBeNull();
  });

  it("falha em um repositório vai para reportPartial e não derruba os outros", async () => {
    const ctx = fakeCtx({ serve: (url) => (repoOf(url) === "frontendbr/vagas" ? fixtures["frontendbr/vagas"] : undefined) });
    const raws = await collect(github.fetch(ctx));
    expect(raws).toHaveLength(fixtures["frontendbr/vagas"]!.length);
    expect(ctx.partials.map((p) => p.label).sort()).toEqual(
      GITHUB_REPOS.filter((r) => r !== "frontendbr/vagas").sort(),
    );
  });

  it("se todos os repositórios falham, lança erro", async () => {
    await expect(collect(github.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
  });

  it("issue fechada não vem na coleta (o runner expira a vaga que sumiu)", async () => {
    const before = fixtures["frontendbr/vagas"]!;
    const closed = before[0]!;
    const after = before.filter((i) => i.number !== closed.number);
    const ctx = fakeCtx({ serve: (url) => (repoOf(url) === "frontendbr/vagas" ? after : undefined) });
    const jobs = (await collect(github.fetch(ctx))).map(github.normalize).filter((j) => j !== null);
    expect(jobs.map((j) => j.externalId)).not.toContain(`frontendbr/vagas#${closed.number}`);
    expect(github.fullSnapshot).toBe(true);
  });

  it("[Remoto] vira remote, labels viram senioridade e o resto vem do título e do corpo", async () => {
    const raws = await collect(github.fetch(fakeCtx({ serve })));
    const jobs = raws.map(github.normalize).filter((j) => j !== null);
    const first = jobs.find((j) => j.externalId === `frontendbr/vagas#${fixtures["frontendbr/vagas"]![0]!.number}`)!;
    expect(first.workModeHint).toBe("remote");
    expect(first.seniorityHint).toBe("senior");
    expect(first.title).toBe("React Native Developer (Dev Co-founder, Sênior)");
    expect(first.company).toBe("Still");
    expect(first.descriptionHtml).toContain("## Nossa empresa");
    expect(first.tags).toEqual(["Sênior", "PJ", "Remoto"]);
    expect(first.publishedAt).toBeInstanceOf(Date);

    const bh = jobs.find((j) => j.title.startsWith("Senior Software Engineer, Full Stack"))!;
    expect(bh.company).toBe("Google");
    expect(bh.city).toBe("Belo Horizonte");
    expect(bh.country).toBe("BR");
    expect(bh.workModeHint).toBeNull();
  });

  it("mapeia cada label de senioridade", () => {
    const base = { number: 9, title: "[Remoto] Dev na X", html_url: "https://github.com/a/b/issues/9", repo: "a/b" };
    const seniority = (name: string) => github.normalize({ ...base, labels: [{ name }] })?.seniorityHint;
    expect(seniority("Estágio")).toBe("intern");
    expect(seniority("Júnior")).toBe("junior");
    expect(seniority("Pleno")).toBe("mid");
    expect(seniority("Sênior")).toBe("senior");
    expect(seniority("Especialista")).toBe("lead");
    expect(seniority("PJ")).toBeNull();
  });

  it("separa a empresa do cargo em títulos reais com vários ' - ', preposição e sufixo '| PJ'", () => {
    const parse = (title: string) => {
      const j = github.normalize({ number: 1, title, html_url: "https://github.com/a/b/issues/1", repo: "a/b", labels: [] })!;
      return { title: j.title, company: j.company };
    };
    expect(parse("[Remoto] Desenvolvedor(a) Backend Pleno - White Label e Plataforma - Mimix AI")).toEqual({
      title: "Desenvolvedor(a) Backend Pleno - White Label e Plataforma",
      company: "Mimix AI",
    });
    expect(parse("[Remoto] Desenvolvedor(a) Back-end Júnior - Python / AI Coding & Agentic AI - MKdigital")).toEqual({
      title: "Desenvolvedor(a) Back-end Júnior - Python / AI Coding & Agentic AI",
      company: "MKdigital",
    });
    expect(parse("[Remoto] Full-Stack Sênior na Igma | PJ")).toEqual({ title: "Full-Stack Sênior", company: "Igma" });
    expect(parse("[Híbrido] Sr Software Engineer - Stealth")).toEqual({ title: "Sr Software Engineer", company: "Stealth" });
    expect(parse("[Remoto] Back-end Developer JR - PORT LOUIS")).toEqual({ title: "Back-end Developer JR", company: "PORT LOUIS" });
    expect(parse("[Remoto] React Native Developer (Dev Co-founder, Sênior) na Still").company).toBe("Still");
    expect(parse("[HÍBRIDO] [São Paulo] Tech Lead | Data Foundation")).toEqual({
      title: "Tech Lead | Data Foundation",
      company: "Não informada",
    });
  });

  it("títulos da fixture não carregam separadores nem sufixo no nome da empresa", async () => {
    const raws = await collect(github.fetch(fakeCtx({ serve })));
    for (const j of raws.map(github.normalize).filter((j) => j !== null)) {
      expect(j.company).not.toMatch(/ - |\|/);
    }
  });
});
