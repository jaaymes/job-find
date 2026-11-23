import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HN_HOST, hn, parseHeader } from "@/lib/server/sources/hn";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import type { WorkMode } from "@/lib/shared/types/job";
import { collect, fakeCtx } from "./helpers";

type Comment = { id: number; text: string | null };
const dir = resolve(import.meta.dirname, "../../../fixtures/sources/hn");
const search = JSON.parse(readFileSync(resolve(dir, "search.json"), "utf8")) as { hits: { objectID: string; title: string }[] };
const thread = JSON.parse(readFileSync(resolve(dir, "thread.json"), "utf8")) as { id: number; children: Comment[] };

/** Thread "Who is hiring?" mais recente da fixture (a de "Who wants to be hired?" vem logo ao lado na busca). */
const HIRING_ID = "50338728";
const WANTS_ID = "50338726";

function serve(url: URL): unknown {
  if (url.origin !== `https://${HN_HOST}`) return undefined;
  if (url.pathname === "/api/v1/search_by_date") return search;
  if (url.pathname === `/api/v1/items/${HIRING_ID}`) return thread;
  return undefined;
}

describe("conector Hacker News (Who is hiring)", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(hn.id).toBe("hn");
    expect(hn.fullSnapshot).toBe(false);
    expect(hn.brazilian).toBe(false);
    expect(hn.minIntervalMinutes).toBe(360);
    expect(hn.allowedHosts).toEqual([HN_HOST]);
    expect(hn.attribution).toEqual({ label: "Hacker News", url: "https://news.ycombinator.com", dofollow: false });
    expect(CONNECTORS.hn).toBe(hn);
  });

  it("acha a thread 'Who is hiring?' mais recente do whoishiring e busca os comentários dela", async () => {
    expect(search.hits.map((h) => h.objectID)).toContain(WANTS_ID);
    const ctx = fakeCtx({ serve });
    const raws = await collect(hn.fetch(ctx));
    const search1 = new URL(ctx.requests[0]!.url);
    expect(search1.searchParams.get("tags")).toBe("story,author_whoishiring");
    expect(new URL(ctx.requests[1]!.url).pathname).toBe(`/api/v1/items/${HIRING_ID}`);
    expect(ctx.requests).toHaveLength(2);
    expect(raws).toHaveLength(thread.children.length);
    expect(ctx.cursors).toEqual([]);
  });

  it("falha se a thread não existe na busca ou não carrega", async () => {
    await expect(collect(hn.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
    const onlyWants = { hits: search.hits.filter((h) => !/who is hiring/i.test(h.title)) };
    await expect(collect(hn.fetch(fakeCtx({ serve: (u) => (u.pathname.includes("search_by_date") ? onlyWants : undefined) })))).rejects.toThrow();
    await expect(
      collect(hn.fetch(fakeCtx({ serve: (u) => (u.pathname.includes("search_by_date") ? search : undefined) }))),
    ).rejects.toThrow();
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const raws = await collect(hn.fetch(fakeCtx({ serve })));
    const jobs = raws.map(hn.normalize).filter((j) => j !== null);
    expect(jobs.length).toBeGreaterThan(20);
    expect(jobs.length).toBeLessThan(raws.length);
    for (const j of jobs) {
      expect(j.externalId).toBeTruthy();
      expect(safeUrl(j.url, { allowHttp: true })).not.toBeNull();
      expect(j.url).toBe(`https://news.ycombinator.com/item?id=${j.externalId}`);
      expect(j.title).toBeTruthy();
      expect(j.company).toBeTruthy();
      expect(j.descriptionFormat).toBe("html");
      expect(j.descriptionHtml).toContain("<p>");
      expect(j.publishedAt).toBeInstanceOf(Date);
    }
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(jobs.length);
    expect(hn.normalize({ lixo: true })).toBeNull();
  });

  it("mapeia empresa, cargo, local, modelo de trabalho e regiões de um comentário no formato", () => {
    const raws = thread.children;
    const simple = hn.normalize(raws.find((c) => c.id === 50338732))!;
    expect(simple).toMatchObject({
      externalId: "50338732",
      company: "Simple Analytics",
      title: "DevOps Engineer",
      workModeHint: "remote",
      companyLogoUrl: null,
      salary: null,
    });
    const juro = hn.normalize(raws.find((c) => c.id === 50339551))!;
    expect(juro.eligibleRegions).toEqual(["United Kingdom"]);
    expect(juro.workModeHint).toBe("remote");
    const equall = hn.normalize(raws.find((c) => c.id === 50339511))!;
    expect(equall.city).toBe("New York");
    expect(equall.country).toBe("US");
    expect(equall.workModeHint).toBe("onsite");
  });

  it("devolve null para comentários fora do formato, vazios ou removidos", () => {
    expect(hn.normalize({ id: 1, text: "Looking for a job, DM me." })).toBeNull();
    expect(hn.normalize({ id: 2, text: "Empresa | Local" })).toBeNull();
    expect(hn.normalize({ id: 3, text: "Empresa | Remote | Full-time" })).toBeNull();
    expect(hn.normalize({ id: 4, text: null })).toBeNull();
    expect(hn.normalize({ id: 5, text: "" })).toBeNull();
    expect(parseHeader("<p>Empresa | Dev Backend | Remote")).toBeNull();
  });
});

// --- precisão do parser heurístico (RF-02: pelo menos 80%) ---------------------------------------

type Label = { company: string; title: string; workMode: WorkMode | null };

/**
 * Rótulos feitos à mão, lendo a primeira linha de cada comentário (não a saída do parser).
 * `null` = o comentário não traz empresa e cargo no formato com pipes e deve ser descartado.
 * Os 60 primeiros comentários da thread vêm na ordem original; o parser erra de propósito
 * em alguns casos reais (cargo sem palavra de função, empresa fora da 1ª posição etc.) e eles
 * ficam rotulados com o valor correto, não com o que o parser devolve.
 */
const L = (company: string, title: string, workMode: WorkMode | null): Label => ({ company, title, workMode });
const LABELS: Record<number, Label | null> = {
  50338732: L("Simple Analytics", "DevOps Engineer", "remote"),
  50338736: L("Synteq", "Growth Lead & Systems Administrator", "remote"),
  50338768: L("University of Cambridge, University of Manchester", "PhD in AI / Earth Observation / Environmental Science", "onsite"),
  50338775: L("Open Education Applications / Neon", "Senior Frontend Engineer", "hybrid"),
  50338792: null,
  50338809: L("Bridge AI Consulting", "AI Consultant, Junior AI Consultant", "remote"),
  50338822: L("United Risk", "Early-Career AI Engineers – Full-Stack, Data Science, Infrastructure/DevOps (10 openings)", "hybrid"),
  50338830: L("We The Flywheel", "Brand Identity Designer (AI-agent team)", "remote"),
  50338907: L("PostHog", "Technical CSMs, SRE, Product Manager, AI Research Engineer", "remote"),
  50338951: null,
  50339013: L("MixRank (YC S11)", "Software Engineers", "remote"),
  50339036: L("Fusionality", "Multiple Positions (Controls, SciML, Data Engineering)", "onsite"),
  50339042: L("CoreWeave", "Senior Specialist Field Engineers (Kubernetes, Security, Storage, Compute Infrastructure)", "hybrid"),
  50339081: L("ORFF Maestra", "Prototype Developer; Technical Product Lead", "remote"),
  50339161: L(
    "Confidential (established Saudi engineering & industrial services group, building a new in-house AI unit)",
    "Senior AI/ML Engineer, Senior Backend Engineer",
    "onsite",
  ),
  50339225: L("FutureSearch", "Multiple senior roles", "remote"),
  50339269: L("myDataValue", "Founding Product Engineer", "hybrid"),
  50339282: L("Starbridge", "Senior Product Engineer", null),
  50339294: null,
  50339308: L("Kraus Hamdani Aerospace", "Software Engineer", "remote"),
  50339364: null,
  50339383: L("Tandem Health", "Engineers, Designers, PMs", "onsite"),
  50339441: L("Lyra", "Applied AI Engineer", "remote"),
  50339454: null,
  50339468: null,
  50339511: L("Equall", "Backend Engineer, Foundations", "onsite"),
  50339514: L("Mastra", "Founding Sales (Founding AE)", "remote"),
  50339551: L("Juro", "AI Engineer (Agentic team)", "remote"),
  50339641: L("CNH", "AI Engineer Intern", "onsite"),
  50339735: null,
  50339750: L("Stream", "Multiple Positions", "remote"),
  50339853: L("Better Stack", "Full-stack Engineer", "remote"),
  50339881: null,
  50339895: L("UMH", "Product Engineer", "onsite"),
  50339975: L("humans&", "Product Engineer (Member of Technical Staff)", "onsite"),
  50340101: L("River", "Staff Engineers (Elixir)", "remote"),
  50340113: L("Charly", "Sales / Account Executive GovTech", "onsite"),
  50340134: L("Stratirus (a Tennetech company)", "AI Developer + Linux Admin (junior to mid)", "remote"),
  50340242: L("Rune Labs", "Senior or Lead Backend Engineer", "remote"),
  50340287: L("JPMorganChase", "Lead Software Engineer", "onsite"),
  50340419: L("Paramark", "Software Engineer (L4)", "hybrid"),
  50340434: L("Voluntas", "Software Engineer", "remote"),
  50340438: L("Thunder Compute (YC S24)", "C++ Systems Engineer", "onsite"),
  50340449: L("Mesmer (YC P25)", "Founding Engineer", "onsite"),
  50340480: L("AI x Healthcare Startup", "Early Engineer", "onsite"),
  50340551: L("Helmsted", "Founding AI Engineer", "remote"),
  50340560: L("Albs Labs", "Member of Technical Staff (Multiple Positions)", "onsite"),
  50340568: L("Sidekick Labs", "Senior Technical Product Manager", "remote"),
  50340584: null,
  50340600: L("Distru", "AI Product Engineer", "remote"),
  50340820: L("Postscript (YC W19)", "Senior Software Engineer, Full Stack", "remote"),
  50340840: L("Mozilla", "Sr. Staff Software Engineer, Browser (New Products)", "remote"),
  50340892: L("Ledgebrook", "Engineering, Product & Data", "remote"),
  50340942: null,
  50340983: L("VIVA Finance", "Front-End + Mobile Developer", "onsite"),
  50340985: L("Memorang", "Product Engineers + Design Engineers + Technical Project Manager + Sales Engineer", null),
  50341026: L("Paradromics", "Embedded Software Engineer", "onsite"),
  50341284: L("Uncountable", "Full-Stack Engineering", "onsite"),
  50341328: L("Fredrin", "GTM Engineer", "remote"),
  50341345: L("SadServers", "Software Engineer", "remote"),
  // Fora do formato: texto corrido, "Apply here", campos em linhas separadas, avisos de vaga preenchida.
  50341745: null,
  50342858: null,
  50344339: null,
  50344341: null,
  50344555: null,
  50346871: null,
  50348055: null,
  50348145: null,
};

describe("precisão do parser de comentários", () => {
  const byId = new Map(thread.children.map((c) => [c.id, c]));
  const results = Object.entries(LABELS).map(([id, label]) => {
    const job = hn.normalize(byId.get(Number(id)));
    const got: Label | null = job ? { company: job.company, title: job.title, workMode: job.workModeHint } : null;
    return { id, label, got, ok: JSON.stringify(got) === JSON.stringify(label) };
  });

  it("os rótulos cobrem comentários no formato (20 ou mais) e fora dele (vários)", () => {
    for (const id of Object.keys(LABELS)) expect(byId.has(Number(id))).toBe(true);
    const inFormat = results.filter((r) => r.label !== null).length;
    const outOfFormat = results.filter((r) => r.label === null).length;
    expect(inFormat).toBeGreaterThanOrEqual(20);
    expect(outOfFormat).toBeGreaterThanOrEqual(5);
  });

  it("acerta empresa, cargo e modelo de trabalho em pelo menos 80% dos comentários rotulados", () => {
    const accuracy = results.filter((r) => r.ok).length / results.length;
    expect(accuracy, JSON.stringify(results.filter((r) => !r.ok))).toBeGreaterThanOrEqual(0.8);
  });

  it("acerta pelo menos 80% só entre os comentários no formato (sem o acerto trivial dos descartes)", () => {
    const inFormat = results.filter((r) => r.label !== null);
    const accuracy = inFormat.filter((r) => r.ok).length / inFormat.length;
    expect(accuracy, `${inFormat.filter((r) => r.ok).length}/${inFormat.length}`).toBeGreaterThanOrEqual(0.8);
  });

  it("não aceita nenhum comentário fora do formato (sem falso positivo)", () => {
    const falsePositives = results.filter((r) => r.label === null && r.got !== null);
    expect(falsePositives).toEqual([]);
  });
});
