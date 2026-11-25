import "client-only";
import { beforeEach, describe, expect, it } from "vitest";
import { profileStore } from "@/lib/client/profile/store";
import { parseBackup } from "@/lib/client/storage/backup";
import { emptyProfile, migrateProfileV1toV2, Profile } from "@/lib/shared/schemas/profile";

const KEY = "jobfind:v1:profile";

function v1Profile(): Record<string, unknown> {
  const { projects: _p, certifications: _c, languages: _l, highlights: _h, ...rest } = emptyProfile();
  void _p;
  void _c;
  void _l;
  void _h;
  return {
    ...rest,
    schemaVersion: 1,
    name: "Ana Exemplo",
    experiences: [
      { id: "exp_1", company: "A", title: "Dev", startDate: "2020-01", endDate: null, bullets: [{ id: "exp_1.b1", text: "x" }] },
    ],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("migrateProfileV1toV2", () => {
  it("acrescenta listas vazias e schemaVersion 2, preservando o resto", () => {
    const v1 = v1Profile();
    const out = migrateProfileV1toV2(v1) as Record<string, unknown>;
    expect(Profile.safeParse(out).success).toBe(true);
    expect(out.schemaVersion).toBe(2);
    for (const k of ["projects", "certifications", "languages", "highlights"]) expect(out[k]).toEqual([]);
    const { schemaVersion: _a, ...restOut } = out;
    const { schemaVersion: _b, ...restIn } = v1;
    void _a;
    void _b;
    for (const k of Object.keys(restIn)) expect(restOut[k]).toEqual(restIn[k]);
  });

  it("devolve valores que não são objeto como vieram", () => {
    expect(migrateProfileV1toV2("x")).toBe("x");
    expect(migrateProfileV1toV2(null)).toBeNull();
  });
});

describe("profileStore com dado v1", () => {
  it("migra o perfil v1 gravado", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: v1Profile() }));
    const p = profileStore.get();
    expect(p?.name).toBe("Ana Exemplo");
    expect(p?.schemaVersion).toBe(2);
    expect(p?.projects).toEqual([]);
  });

  it("perfil v1 inválido (sem experiences) devolve null", () => {
    const { experiences: _e, ...bad } = v1Profile();
    void _e;
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: bad }));
    expect(profileStore.get()).toBeNull();
  });
});

describe("parseBackup com perfil v1", () => {
  it("migra o perfil v1 do arquivo", async () => {
    const file = new File(
      [JSON.stringify({ format: "jobfind-backup", v: 1, exportedAt: "2026-11-20T00:00:00.000Z", data: { [KEY]: v1Profile() } })],
      "b.json",
      { type: "application/json" },
    );
    const r = await parseBackup(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.keys).toContain(KEY);
    expect((r.backup.data[KEY] as Profile).schemaVersion).toBe(2);
  });
});
