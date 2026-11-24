import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appliedAt,
  jobStateStore,
  setFavorite,
  setHidden,
  setStatus,
  syncSnapshots,
  type SnapshotSource,
} from "@/lib/client/jobs/job-state";

const KEY = "jobfind:v1:jobState";

const job = (id = 7, over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  id,
  title: "Desenvolvedor React",
  company: "Acme",
  stacks: ["react"],
  workMode: "remote",
  publishedAt: "2026-11-20T12:00:00.000Z",
  urlCanonical: "https://boards.example.com/acme/7",
  ...over,
});

const all = () => jobStateStore.get();

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("job-state", () => {
  it("favoritar grava o snapshot na primeira interação", () => {
    expect(setFavorite(job(), true)).toEqual({ ok: true });
    const s = all()["7"];
    expect(s.favorite).toBe(true);
    expect(s.hidden).toBe(false);
    expect(s.status).toBe("none");
    expect(s.snapshot).toEqual({
      id: 7,
      title: "Desenvolvedor React",
      company: "Acme",
      urlCanonical: "https://boards.example.com/acme/7",
      stacks: ["react"],
      workMode: "remote",
      publishedAt: "2026-11-20T12:00:00.000Z",
    });
  });

  it("snapshot sem urlCanonical (vinda da listagem) fica com null", () => {
    setFavorite(job(7, { urlCanonical: undefined }), true);
    expect(all()["7"].snapshot.urlCanonical).toBeNull();
  });

  it("aceita qualquer transição de status, inclusive voltar para none, e registra o histórico com data", () => {
    vi.useFakeTimers();
    const steps = ["saved", "applied", "interview", "offer", "rejected", "applied", "none"] as const;
    steps.forEach((status, i) => {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 20 + i, 10)));
      setStatus(job(), status);
      expect(all()["7"].status).toBe(status);
    });
    const h = all()["7"].statusHistory;
    expect(h.map((x) => x.status)).toEqual([...steps]);
    expect(h[1].at).toBe("2026-11-21T10:00:00.000Z");
    expect(h.every((x) => !Number.isNaN(Date.parse(x.at)))).toBe(true);
  });

  it("repetir o mesmo status não duplica o histórico", () => {
    setStatus(job(), "applied");
    setStatus(job(), "applied");
    expect(all()["7"].statusHistory).toHaveLength(1);
  });

  it("appliedAt devolve a data da última mudança para Aplicada", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T09:00:00.000Z"));
    setStatus(job(), "applied");
    expect(appliedAt(all()["7"])).toBe("2026-11-22T09:00:00.000Z");
    setStatus(job(), "none");
    expect(appliedAt(all()["7"])).toBeNull();
  });

  it("ocultar e mostrar de novo; entrada sem nenhum sinal é removida", () => {
    setHidden(job(), true);
    expect(all()["7"].hidden).toBe(true);
    setHidden(job(), false);
    expect(all()["7"]).toBeUndefined();
  });

  it("não remove a entrada se há favorito, status ou histórico", () => {
    setFavorite(job(), true);
    setFavorite(job(), false);
    expect(all()["7"]).toBeUndefined();
    setStatus(job(), "applied");
    setStatus(job(), "none");
    expect(all()["7"]).toBeDefined();
  });

  it("syncSnapshots atualiza título e empresa só de vagas que já têm estado", () => {
    setFavorite(job(), true);
    expect(syncSnapshots([job(7, { title: "Dev React Sênior", company: "Acme Ltda" }), job(8)])).toBe(true);
    expect(all()["7"].snapshot.title).toBe("Dev React Sênior");
    expect(all()["7"].snapshot.company).toBe("Acme Ltda");
    expect(all()["8"]).toBeUndefined();
    expect(syncSnapshots([job(7, { title: "Dev React Sênior", company: "Acme Ltda" })])).toBe(false);
  });

  it("syncSnapshots sem urlCanonical não apaga o que já estava salvo", () => {
    setFavorite(job(), true);
    syncSnapshots([job(7, { title: "Novo", urlCanonical: undefined })]);
    expect(all()["7"].snapshot.urlCanonical).toBe("https://boards.example.com/acme/7");
  });

  it("uma entrada corrompida some sozinha, sem levar as outras", () => {
    setFavorite(job(1), true);
    setFavorite(job(2), true);
    const env = JSON.parse(localStorage.getItem(KEY)!);
    env.data["2"].status = "inexistente";
    env.data["3"] = "lixo";
    env.data["abc"] = env.data["1"];
    localStorage.setItem(KEY, JSON.stringify(env));
    expect(Object.keys(all())).toEqual(["1"]);
  });

  it("uma chave que não bate com o id do snapshot é descartada", () => {
    setFavorite(job(1), true);
    const env = JSON.parse(localStorage.getItem(KEY)!);
    env.data["9"] = env.data["1"];
    localStorage.setItem(KEY, JSON.stringify(env));
    expect(Object.keys(all())).toEqual(["1"]);
  });
});
