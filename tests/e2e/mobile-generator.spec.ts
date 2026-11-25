import { expect, test, type Page } from "@playwright/test";
import { getJob } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";
import { seedDatabase, type E2eDb } from "./seed";

// Gerador no celular (Pixel 7): abas Editar / Pré-visualizar e pré-visualização do PDF em canvas.
// O registro já gerado vem do localStorage: nenhuma chamada de IA.

const AI_KEY = "jobfind:v1:ai";
const PROFILE_KEY = "jobfind:v1:profile";
const DOCS_KEY = "jobfind:v1:generatedDocs";

const EMAIL = "ana.exemplo@exemplo.test";
const PHONE_DIGITS = "98888-7777";
const STREET = "Rua das Flores, 123";

const PROFILE = {
  v: 1,
  data: {
    schemaVersion: 1,
    name: "Ana Exemplo",
    headline: "Desenvolvedora Full Stack",
    location: "São Paulo, SP, Brasil",
    seniority: "senior",
    englishLevel: "advanced",
    summary: `Desenvolvedora com React e TypeScript. Moro na ${STREET}.`,
    contact: { email: EMAIL, phone: `(11) ${PHONE_DIGITS}`, links: ["https://github.com/ana-exemplo"] },
    skills: [
      { name: "React", years: 5, stackId: "react" },
      { name: "TypeScript", years: 6, stackId: "typescript" },
    ],
    experiences: [
      {
        id: "exp_1",
        company: "Empresa Ficticia Ltda",
        title: "Desenvolvedora Sênior",
        startDate: "2020-01",
        endDate: null,
        bullets: [
          { id: "exp_1.b1", text: "Reduziu o tempo de carregamento em 40% com React" },
          { id: "exp_1.b2", text: "Liderou a migração do front-end para Next.js" },
        ],
      },
    ],
    education: [],
  },
};

const AI_SETTINGS = {
  v: 1,
  data: {
    providers: { deepseek: { key: "sk-test-deepseek-1234", addedAt: "2026-11-20T00:00:00.000Z", source: "paste", privacyAccepted: true } },
    tasks: { extract: null, analyze: null, cv: null },
    dataCollectionDeny: true,
    minimizePii: true,
  },
};

const RECORD = {
  v: 1,
  data: {
    "1": {
      cv: {
        headline: "Desenvolvedora Full Stack",
        summary: "Desenvolvedora com experiência em React e TypeScript.",
        skills: ["React", "TypeScript"],
        experiences: [
          { expId: "exp_1", bullets: [{ text: "Reduziu o tempo de carregamento em 40% com React.", sourceBulletIds: ["exp_1.b1"] }] },
        ],
      },
      coverLetter: null,
      provider: "deepseek",
      model: "m",
      promptVersion: 1,
      createdAt: "2026-11-24T00:00:00.000Z",
      lang: "pt",
      includeLetter: false,
      edits: null,
      approvedFlags: [],
    },
  },
};

let db: E2eDb;
let closeDb: () => Promise<void>;

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
});

test.afterAll(async () => {
  await closeDb();
});

async function open(page: Page) {
  await page.addInitScript(
    (e) => {
      for (const [k, v] of Object.entries(e)) if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, JSON.stringify(v));
    },
    { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE, [DOCS_KEY]: RECORD },
  );
  await page.route("**/api/jobs/*", async (route) => {
    const raw = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const job = /^\d+$/.test(raw) ? await getJob(db, Number(raw), attributionFor) : null;
    if (!job) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Vaga não encontrada." } } });
    return route.fulfill({ json: job });
  });
  await page.goto("/gerador/1");
}

test("no celular, a aba Pré-visualizar mostra o PDF em canvas e a barra de ação", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(err.message));
  await open(page);

  // Sem barra de abas do app: a página tem a própria barra de ação.
  await expect(page.getByRole("navigation", { name: "Navegação inferior" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Editar" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Título profissional")).toBeVisible();

  await page.getByRole("tab", { name: "Pré-visualizar" }).click();
  await expect(page.getByRole("tab", { name: "Pré-visualizar" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Página 1 do PDF")).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir PDF em tela cheia/ })).toHaveAttribute("href", /^blob:/);
  await expect(page.locator("iframe")).toHaveCount(0);

  const bar = page.getByRole("group", { name: "Ações do documento" });
  await expect(bar.getByRole("button", { name: "Gerar de novo" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Baixar PDF" })).toBeVisible();
  expect(problems).toEqual([]);
});
