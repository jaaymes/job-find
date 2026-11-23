import { beforeEach, describe, expect, it } from "vitest";
import { applyBackup, backupFilename, exportBackup, parseBackup, stripMarkup, type Backup } from "@/lib/client/storage/backup";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { jobStateStore } from "@/lib/client/jobs/job-state";
import { profileStore } from "@/lib/client/profile/store";
import { analysisStore } from "@/lib/client/jobs/analysis-store";
import { emptyProfile } from "@/lib/shared/schemas/profile";

const AI = "jobfind:v1:ai";
const ORIGINAL_KEY = "sk-original-9999";
const ATTACKER_KEY = "sk-attacker-1234";
const added = "2026-11-20T00:00:00.000Z";

const jsonFile = (value: unknown, name = "backup.json") =>
  new File([JSON.stringify(value)], name, { type: "application/json" });

const aiWith = (keys: Record<string, string>) => ({
  ...defaultAiSettings(),
  providers: Object.fromEntries(
    Object.entries(keys).map(([id, key]) => [id, { key, addedAt: added, source: "paste" as const }]),
  ),
});

const envelope = (data: Record<string, unknown>) => ({ format: "jobfind-backup", v: 1, exportedAt: added, data });

const snapshot = (over: Record<string, unknown> = {}) => ({
  id: 7,
  title: "Dev",
  company: "Acme",
  urlCanonical: "https://boards.example.com/acme/7",
  stacks: ["react"],
  workMode: "remote",
  publishedAt: added,
  ...over,
});
const jobState = (snap = snapshot()) => ({
  favorite: true,
  hidden: false,
  status: "none",
  statusHistory: [],
  snapshot: snap,
});

async function parsed(file: File) {
  const r = await parseBackup(file);
  if (!r.ok) throw new Error(`esperava ok, veio ${r.reason}`);
  return r;
}

const currentKey = (id: string) =>
  (aiSettingsStore.get().providers as Record<string, { key?: string } | undefined>)[id]?.key;

beforeEach(() => localStorage.clear());

describe("exportBackup", () => {
  it("remove as chaves de todos os provedores por padrão e preserva o resto", async () => {
    aiSettingsStore.set(aiWith({ openai: ORIGINAL_KEY, openrouter: "sk-or-v1-abcd5678", anthropic: "sk-ant-0000" }));
    const out = JSON.parse(await exportBackup({ includeKeys: false }).text());
    expect(out.format).toBe("jobfind-backup");
    expect(out.v).toBe(1);
    const providers = out.data[AI].providers;
    for (const id of ["openai", "openrouter", "anthropic"]) {
      expect(providers[id].key).toBeUndefined();
      expect(providers[id].source).toBe("paste");
    }
    expect(JSON.stringify(out)).not.toContain(ORIGINAL_KEY);
  });

  it("inclui as chaves só com includeKeys", async () => {
    aiSettingsStore.set(aiWith({ openai: ORIGINAL_KEY }));
    const out = JSON.parse(await exportBackup({ includeKeys: true }).text());
    expect(out.data[AI].providers.openai.key).toBe(ORIGINAL_KEY);
  });

  it("exporta só as chaves que existem e nomeia o arquivo com a data", async () => {
    profileStore.set(emptyProfile());
    const out = JSON.parse(await exportBackup({ includeKeys: false }).text());
    expect(Object.keys(out.data)).toEqual(["jobfind:v1:profile"]);
    expect(backupFilename(new Date("2026-11-23T10:00:00Z"))).toBe("jobfind-backup-2026-11-23.json");
  });
});

describe("parseBackup", () => {
  it("rejeita arquivo acima de 5 MB sem ler o conteúdo", async () => {
    const big = new File([new Uint8Array(6e6)], "grande.json");
    expect(await parseBackup(big)).toEqual({ ok: false, reason: "too_large" });
    const exactly = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "x.json");
    expect(await parseBackup(exactly)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejeita JSON inválido, formato errado, versão errada e campos extras no envelope", async () => {
    expect(await parseBackup(new File(["{nao é json"], "a.json"))).toEqual({ ok: false, reason: "invalid" });
    expect((await parseBackup(jsonFile({ ...envelope({}), format: "outro" }))).ok).toBe(false);
    expect((await parseBackup(jsonFile({ ...envelope({}), v: 2 }))).ok).toBe(false);
    expect((await parseBackup(jsonFile({ ...envelope({ [AI]: defaultAiSettings() }), extra: 1 }))).ok).toBe(false);
  });

  it("não polui o protótipo com __proto__ nem constructor", async () => {
    const raw = `{"format":"jobfind-backup","v":1,"exportedAt":"${added}","data":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"jobfind:v1:profile":null}}`;
    const r = await parsed(new File([raw], "p.json"));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.keys).toEqual(["jobfind:v1:profile"]);
    expect(r.skipped).toContain("constructor");
    expect(Object.getPrototypeOf(r.backup.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("só __proto__ no data: nada para importar", async () => {
    const raw = `{"format":"jobfind-backup","v":1,"exportedAt":"${added}","data":{"__proto__":{"polluted":true}}}`;
    const r = await parseBackup(new File([raw], "p.json"));
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("campo desconhecido reprova só aquela chave; as outras seguem", async () => {
    const r = await parsed(
      jsonFile(
        envelope({
          [AI]: { ...defaultAiSettings(), intruso: true },
          "jobfind:v1:jobState": { "7": jobState() },
          "jobfind:v1:savedFilters": [{ a: 1 }],
        }),
      ),
    );
    expect(r.keys).toEqual(["jobfind:v1:jobState"]);
    expect(r.skipped).toEqual(["jobfind:v1:ai", "jobfind:v1:savedFilters"]);
  });

  it("campo desconhecido aninhado também reprova (snapshot e provedor)", async () => {
    const nested = await parseBackup(
      jsonFile(envelope({ "jobfind:v1:jobState": { "7": jobState(snapshot({ extra: "x" })) } })),
    );
    expect(nested.ok).toBe(false);
    const prov = await parseBackup(
      jsonFile(envelope({ [AI]: { ...defaultAiSettings(), providers: { openai: { addedAt: added, source: "paste", x: 1 } } } })),
    );
    expect(prov.ok).toBe(false);
  });

  it("keyHints traz só os 4 últimos caracteres de cada provedor, nunca a chave", async () => {
    const r = await parsed(jsonFile(envelope({ [AI]: aiWith({ openai: ATTACKER_KEY, anthropic: "sk-ant-api-abcd5678" }) })));
    expect(r.hasKeys).toBe(true);
    expect(r.keyHints.openai).toBe("1234");
    expect(r.keyHints.anthropic).toBe("5678");
    expect(JSON.stringify(r.keyHints)).not.toContain("attacker");
  });

  it("backup sem chaves: hasKeys falso", async () => {
    const r = await parsed(jsonFile(envelope({ [AI]: defaultAiSettings(), "jobfind:v1:profile": null })));
    expect(r.hasKeys).toBe(false);
    expect(r.keyHints).toEqual({});
  });

  it("ressanitiza snapshots: <img onerror> vira texto inerte e URL javascript: é anulada", async () => {
    const evil = snapshot({
      title: 'Dev <img src=x onerror="alert(1)">Sênior',
      company: "<script>alert(1)</script>Acme <b>S.A.</b>",
      urlCanonical: "javascript:alert(1)",
    });
    const r = await parsed(jsonFile(envelope({ "jobfind:v1:jobState": { "7": jobState(evil) } })));
    const snap = (r.backup.data["jobfind:v1:jobState"] as Record<string, { snapshot: Record<string, unknown> }>)["7"].snapshot;
    expect(snap.title).toBe("Dev Sênior");
    expect(snap.company).toBe("Acme S.A.");
    expect(snap.urlCanonical).toBeNull();
  });

  it("ressanitiza perfil (strings e links) e análises", async () => {
    const profile = {
      ...emptyProfile(),
      name: "Ana <svg onload=alert(1)>",
      summary: "<iframe src=x></iframe>Texto",
      contact: { email: null, phone: null, links: ["https://github.com/ana", "javascript:alert(1)", "lixo"] },
    };
    const analysis = {
      "7": {
        strengths: ["<img src=x onerror=alert(1)>React"],
        gaps: [],
        missingKeywords: [],
        revisedScore: 80,
        provider: "openai",
        model: "m",
        promptVersion: 1,
        createdAt: added,
      },
    };
    const r = await parsed(jsonFile(envelope({ "jobfind:v1:profile": profile, "jobfind:v1:aiAnalysis": analysis })));
    const p = r.backup.data["jobfind:v1:profile"] as typeof profile;
    expect(p.name).toBe("Ana ");
    expect(p.summary).toBe("Texto");
    expect(p.contact.links).toEqual(["https://github.com/ana"]);
    const a = r.backup.data["jobfind:v1:aiAnalysis"] as typeof analysis;
    expect(a["7"].strengths).toEqual(["React"]);
  });

  it("jobState com chave diferente do id do snapshot é recusado", async () => {
    const r = await parseBackup(jsonFile(envelope({ "jobfind:v1:jobState": { "8": jobState() } })));
    expect(r.ok).toBe(false);
  });
});

describe("applyBackup", () => {
  const backupWithKey = async (): Promise<Backup> =>
    (await parsed(jsonFile(envelope({ [AI]: aiWith({ openai: ATTACKER_KEY }) })))).backup;

  it("sem acceptKeys, chaves e provedores existentes ficam exatamente como estavam", async () => {
    aiSettingsStore.set(aiWith({ openai: ORIGINAL_KEY, anthropic: "sk-ant-keep-0001" }));
    const before = localStorage.getItem(AI);
    applyBackup(await backupWithKey(), { acceptKeys: false });
    expect(currentKey("openai")).toBe(ORIGINAL_KEY);
    expect(localStorage.getItem(AI)).toBe(before);
  });

  it("com acceptKeys, substitui a configuração de IA inteira", async () => {
    aiSettingsStore.set(aiWith({ openai: ORIGINAL_KEY, anthropic: "sk-ant-keep-0001" }));
    applyBackup(await backupWithKey(), { acceptKeys: true });
    expect(currentKey("openai")).toBe(ATTACKER_KEY);
    expect(currentKey("anthropic")).toBeUndefined();
  });

  it("backup sem chaves nunca apaga as chaves existentes, mesmo com acceptKeys", async () => {
    aiSettingsStore.set(aiWith({ openai: ORIGINAL_KEY }));
    const b = (await parsed(jsonFile(envelope({ [AI]: defaultAiSettings() })))).backup;
    applyBackup(b, { acceptKeys: true });
    expect(currentKey("openai")).toBe(ORIGINAL_KEY);
  });

  it("substitui cada chave inteira, sem deep merge", async () => {
    jobStateStore.set({ "1": { ...jobState(snapshot({ id: 1 })), favorite: false, hidden: true } as never });
    analysisStore.set({});
    const b = (await parsed(jsonFile(envelope({ "jobfind:v1:jobState": { "7": jobState() } })))).backup;
    applyBackup(b, { acceptKeys: false });
    expect(Object.keys(jobStateStore.get())).toEqual(["7"]);
  });

  it("não grava chaves ausentes do arquivo", async () => {
    profileStore.set({ ...emptyProfile(), name: "Eu" });
    const b = (await parsed(jsonFile(envelope({ "jobfind:v1:jobState": { "7": jobState() } })))).backup;
    applyBackup(b, { acceptKeys: false });
    expect(profileStore.get()?.name).toBe("Eu");
  });
});

describe("stripMarkup", () => {
  it("mantém texto simples, &, < solto e acentos", () => {
    expect(stripMarkup("R&D em São Paulo")).toBe("R&D em São Paulo");
    expect(stripMarkup("a < b")).toBe("a < b");
  });
});
