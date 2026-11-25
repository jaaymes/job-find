# Fase 2: templates de CV e perfil v2 — plano de implementação

> **Para agentes:** sub-skill obrigatória: superpowers:subagent-driven-development (recomendada) ou superpowers:executing-plans, tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** dez templates de CV de coluna única, escolhidos no gerador com recomendação e padrão salvo, sobre um perfil v2 com projetos, certificações, idiomas e destaques.

**Arquitetura:** a migração v1 → v2 entra pelo `createStore` e pela importação de backup. O `AssembledCv` ganha os dados novos. O `CvDocument` passa a montar as seções a partir de um registro de templates (dados + funções de seção puras). O template de cada documento fica no `GeneratedRecord`, e o padrão do usuário na nova store `cvPrefs`.

**Stack:** Next.js 16, React 19, `@react-pdf/renderer`, Zod 4, Vitest (com `unpdf` em node), Playwright.

**Spec:** [docs/tech/2026-11-25-fase2-templates-cv.md](../tech/2026-11-25-fase2-templates-cv.md). As decisões D-01..D-09 da spec valem como requisito em todas as tarefas.

## Restrições globais

- Coluna única. Não usar tabela, `Image`, ícone nem elemento `fixed`. O nome é a primeira linha de texto, o contato fica em texto simples no corpo e cada seção usa o título padrão de `SECTION_LABELS` (RN-30).
- Cor só em títulos e linhas, com contraste ≥ 4.5:1 sobre branco. O texto corrido é `#111111` ou `#333333` (RN-32).
- Nenhuma dependência npm nova, nenhuma variável de ambiente nova, nenhuma feature flag.
- O schema de perfil é o `json_schema` estrito da IA: todos os campos são obrigatórios, e o que for opcional usa `.nullable()`, nunca `.optional()`.
- Os ids dos templates são exatamente: `classico`, `compacto`, `harvard`, `minimalista`, `moderno`, `resultados`, `lideranca`, `inicio-de-carreira`, `transicao`, `internacional`.
- Textos de UI em pt-BR, com acentuação correta.
- A hifenização continua desligada, e a margem entre nome e título continua ≥ 8 pt.
- Verificação por tarefa: `pnpm vitest run <arquivos da tarefa>`, depois `pnpm typecheck && pnpm lint`.
- Mensagem de commit em pt-BR, terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Pontos de atenção na revisão

1. **Perfil v1 com campos extras ou faltando** (por exemplo, sem `contact.links`). A migração não pode transformar um perfil antes válido em `null`, e um perfil já inválido continua inválido. Coberto pelo teste da Tarefa 1.
2. **Destaques órfãos:** um id em `highlights` cujo bullet foi apagado, ou que aponta para um bullet `flagged`. Nenhum dos dois entra no PDF, e a seção some quando não sobra nada. Coberto pelo teste da Tarefa 2.
3. **Registro com `templateId` desconhecido** (vindo de backup ou de versão futura). Cai em `classico` sem quebrar. Coberto pelo teste da Tarefa 5.
4. **Perfil mínimo** (só o nome). Todos os 10 templates geram PDF sem título de seção vazio. Coberto pelo teste da Tarefa 4.
5. **Caracteres pt e es** (ç, ã, ñ, –, •) depois do subconjunto das fontes. Precisam aparecer no texto extraído. Coberto pelo teste da Tarefa 4, com o fixture contendo "Ação, São, Español – Niño".

---

### Tarefa 1: perfil v2, migração, store, backup e prompt de extração v2

**Arquivos:**
- Modificar: `lib/shared/schemas/profile.ts`, `lib/client/profile/store.ts`, `lib/client/storage/backup.ts`, `lib/client/profile/import.ts`, `tests/unit/client/profile-import.test.ts`
- Criar: `lib/client/ai/prompts/profile.extract.v2.ts` (apagar o `profile.extract.v1.ts`)
- Teste: `tests/unit/client/profile-migration.test.ts`
- Ajustar: os fixtures de unidade que montam `Profile` à mão. Rode `pnpm typecheck` para encontrá-los. Os fixtures v1 dos E2E **não mudam**, porque continuam testando a migração.

**Interfaces que esta tarefa entrega:**
- `PROFILE_SCHEMA_VERSION = 2`.
- `LANGUAGE_LEVELS = ["basic","intermediate","advanced","fluent","native"] as const`.
- `LANGUAGE_LEVEL_LABEL: Record<CvLang, Record<LanguageLevel, string>>`, com os rótulos de D-01.
- Novos campos em `Profile`: `projects`, `certifications`, `languages`, `highlights`, com as formas exatas de D-01.
- `MAX_HIGHLIGHTS = 3`.
- `migrateProfileV1toV2(old: unknown): unknown`.
- `emptyProfile()` passa a devolver as listas vazias.
- `PROFILE_EXTRACT_V2: PromptDef<{ cvText: string }, Profile>`, com `version: 2`.

- [ ] **Passo 1: escrever os testes que falham** em `profile-migration.test.ts`:
  - `migrateProfileV1toV2(v1)` com `Profile.safeParse` dá `success`. O resultado tem `projects`, `certifications`, `languages` e `highlights` iguais a `[]`, `schemaVersion === 2`, e os demais campos idênticos aos do v1.
  - `migrateProfileV1toV2("x") === "x"` e `migrateProfileV1toV2(null) === null`.
  - **Pela store:** grava `{v:1,data:v1}` em `jobfind:v1:profile`; `profileStore.get()` devolve o perfil v2 com `name` preservado.
  - **Perfil v1 inválido** (sem `experiences`): `profileStore.get()` devolve `null`.
  - **Backup:** `parseBackup` de um arquivo com `jobfind:v1:profile` v1 (`schemaVersion: 1`) dá `ok: true`, a chave fica em `keys` e o dado volta com `schemaVersion: 2`.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/profile-migration.test.ts`. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **Schema e migração:** o schema e a migração ficam em `profile.ts`. A `profileStore` usa `{ version: 2, migrations: { 1: migrateProfileV1toV2 } }`.
  - **`validateKey(PROFILE)` no backup:** aplica `migrateProfileV1toV2` ao valor bruto quando `schemaVersion === 1`, antes de `strict.profile`.
  - **Prompt v2:** copia o v1 e faz estas mudanças:
    - "schemaVersion é sempre 2";
    - `projects`: projetos pessoais, acadêmicos ou open-source citados, com id `proj_1`… e bullets `proj_N.b1`…, `link` só se for uma URL escrita, `stacks` com as tecnologias citadas no projeto;
    - `certifications`: nome, emissor e ano;
    - `languages`: idiomas com nível mapeado para basic|intermediate|advanced|fluent|native, só quando escritos;
    - `highlights` sempre `[]`.
  - **`import.ts`:** passa a usar o v2. Atualize o `describe` do teste de import para `PROFILE_EXTRACT_V2`.
- [ ] **Passo 4:** rodar `pnpm vitest run tests/unit/client/profile-migration.test.ts tests/unit/client/profile-import.test.ts tests/unit/client/backup.test.ts`, depois `pnpm test`, `pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(perfil): schema v2 com projetos, certificações, idiomas e destaques`

### Tarefa 2: `AssembledCv` com os dados novos e `assembleBaseCv`

**Arquivos:**
- Modificar: `lib/client/cv/assemble.ts`, `lib/client/pdf/CvDocument.tsx` (só `SECTION_LABELS`)
- Teste: `tests/unit/client/cv-assemble.test.ts`

**Interfaces:**
- Usa da Tarefa 1: `Profile` v2 e `LANGUAGE_LEVEL_LABEL`.
- Entrega estas mudanças no `AssembledCv`:
  - `bullets[].sources: string[]`;
  - `projects: { name: string; link: string | null; stacks: string[]; bullets: string[] }[]`;
  - `certifications: string[]`;
  - `languages: string[]`;
  - `highlightKeys: string[]`.
- Entrega `assembleBaseCv(profile: Profile, lang: CvLang): AssembledCv`.
- `SECTION_LABELS[lang]` ganha `projects`, `certifications`, `languages` e `highlights`:
  - pt: "Projetos", "Certificações", "Idiomas", "Destaques";
  - en: "Projects", "Certifications", "Languages", "Key achievements";
  - es: "Proyectos", "Certificaciones", "Idiomas", "Logros destacados".

- [ ] **Passo 1: escrever os testes que falham.**
  - Os bullets montados trazem `sources` iguais aos `sourceBulletIds`.
  - `certifications` vem como `["AWS SAA – Amazon (2023)"]` para `{name:"AWS SAA",issuer:"Amazon",year:"2023"}`. Sem emissor nem ano, vem só o nome.
  - `languages` vem como `["Inglês – Fluente"]` em pt e `["Inglês – Fluent"]` em en. O nome do idioma fica como está no perfil.
  - `projects` copia o perfil e descarta bullets vazios.
  - `highlightKeys`:
    - contém a `key` de cada bullet não sinalizado cujos `sources` cruzam com `profile.highlights`, no máximo 3, na ordem do CV;
    - com `highlights: ["exp_9.b1"]` (órfão), vem `[]`;
    - um bullet com `flagged` não entra (use `review` com uma violação nesse bullet).
  - `assembleBaseCv(profile, "pt")`:
    - headline, resumo e skills na ordem do perfil;
    - uma experiência por item, com os bullets originais e `sources: [b.id]`;
    - todos os flags com `flagged: false`.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/cv-assemble.test.ts`. Esperado: FAIL.
- [ ] **Passo 3: implementar** em `assemble.ts`. `assembleBaseCv` monta um `TailoredDocs` sintético e chama `assembleCv`. O cálculo de `highlightKeys` acontece depois do `flagBullets`.
- [ ] **Passo 4:** rodar o teste, depois `pnpm test`, `pnpm typecheck && pnpm lint`. Esperado: PASS. Os testes de PDF continuam verdes.
- [ ] **Passo 5: commit** `feat(cv): projetos, certificações, idiomas e destaques na montagem do CV`

### Tarefa 3: fontes novas com subconjunto latino

**Arquivos:**
- Criar:
  - `scripts/subset-fonts.sh`;
  - `public/fonts/SourceSerif4-{Regular,Bold}.ttf`, `SourceSans3-{Regular,Bold}.ttf`, `IBMPlexSans-{Regular,Bold}.ttf`;
  - `public/fonts/LICENSE-SourceSerif4.txt`, `LICENSE-SourceSans3.txt`, `LICENSE-IBMPlexSans.txt`.
- Modificar: `lib/client/pdf/fonts.ts`
- Teste: `tests/unit/client/pdf-fonts.test.ts` (node)

**Interfaces que esta tarefa entrega:**
- `type PdfFamily = "Inter" | "Source Serif 4" | "Source Sans 3" | "IBM Plex Sans"`.
- `PDF_FAMILIES: Record<PdfFamily, { regular: string; bold: string; license: string }>`, com os nomes dos arquivos.
- `registerPdfFonts(baseDir?)` registra as 4 famílias (400 e 700).
- `PDF_FONT` continua `"Inter"`.

- [ ] **Passo 1: baixar as fontes e o fonttools.** O PO autorizou em 2026-11-25.
  - Os TTF estáticos e o `OFL.txt` vêm de `github.com/google/fonts`: `ofl/sourceserif4`, `ofl/sourcesans3`, `ofl/ibmplexsans`. Se o google/fonts só tiver a fonte variável, use os releases oficiais `adobe-fonts/source-serif`, `adobe-fonts/source-sans` e `IBM/plex`.
  - Tudo vai para um diretório novo no scratchpad.
  - O fonttools vai num venv do scratchpad: `python3 -m venv <scratch>/ft && <scratch>/ft/bin/pip install fonttools`.
- [ ] **Passo 2: escrever `scripts/subset-fonts.sh <origem> <destino>`.** O script chama `pyftsubset` com `--unicodes="U+0000-00FF,U+0100-017F,U+2000-206F,U+20AC,U+2022"` e `--layout-features='*' --no-hinting`. A saída usa os nomes de arquivo acima. Rode o script e copie as licenças.
- [ ] **Passo 3: escrever o teste que falha** em `pdf-fonts.test.ts`:
  - cada arquivo de `PDF_FAMILIES` existe em `public/fonts`;
  - cada família tem a sua licença;
  - a soma dos 6 TTF novos é ≤ 1_572_864 bytes.
- [ ] **Passo 4: implementar `PDF_FAMILIES` e o registro** em `fonts.ts`, depois rodar `pnpm vitest run tests/unit/client/pdf-fonts.test.ts tests/unit/client/pdf.test.ts`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(pdf): fontes Source Serif 4, Source Sans 3 e IBM Plex Sans (OFL, subconjunto latino)`

### Tarefa 4: registro de templates, renderizador guiado por template, metadados e teste ATS

**Arquivos:**
- Criar: `lib/client/pdf/templates/types.ts`, `registry.ts`, `sections.tsx`
- Modificar: `lib/client/pdf/CvDocument.tsx`, `lib/client/pdf/render.tsx`, `components/generator/PdfPreview.tsx` e `GeneratorScreen.tsx`. Nos componentes, só passar `"classico"` por enquanto, para compilar; a Tarefa 6 liga o id escolhido.
- Teste: `tests/unit/client/pdf-templates.test.ts` (node), `tests/unit/client/pdf.test.ts` (atualizar as chamadas)

**Interfaces:**
- Usa da Tarefa 2: o `AssembledCv` novo e `SECTION_LABELS`. Usa da Tarefa 3: `PdfFamily`.
- Entrega os tipos `CvSectionId`, `CvTemplateId` e `CvTemplate`, com a forma exata de D-02.
- Entrega `CV_TEMPLATES: readonly CvTemplate[]`, na ordem dos ids das Restrições globais.
- Entrega `getTemplate(id: string | null | undefined): CvTemplate`, que cai em `classico` quando o id não existe.
- `CvDocument({ cv, templateId }: { cv: AssembledCv; templateId: CvTemplateId })`.
- `renderCvPdf(cv: AssembledCv, templateId: CvTemplateId, fontsDir?: string)`.

**Valores dos templates.** `sections`, fontes e estilo vêm da tabela 11.2 do PRD. Valem também estas regras:

| id | sections | body / headings | tokens que diferenciam |
|---|---|---|---|
| classico | summary, experience, skills, projects, education, certifications, languages | Inter / Inter | 10 pt, `titleRule: true`, igual ao layout atual |
| compacto | skills, experience, projects, education, certifications, languages | Inter / Inter | 9.5 pt, margens 28/32, `titleCase: "upper"`, `skillsLayout: "grouped"` |
| harvard | education, experience, projects, skills, certifications, languages | Source Serif 4 / Source Serif 4 | `nameAlign: "center"`, `titleRule: true` |
| minimalista | summary, experience, skills, education, languages | Source Sans 3 / Source Sans 3 | `titleRule: false`, `sectionGap` 18 |
| moderno | summary, skills, experience, projects, education, certifications, languages | IBM Plex Sans / IBM Plex Sans | `accent: "#1F3A5F"` |
| resultados | summary, highlights, experience, skills, education, certifications, languages | Inter / Inter | destaques em negrito |
| lideranca | summary, skills, experience, education, certifications, languages | Inter / Source Serif 4 | `titleRule: true` |
| inicio-de-carreira | summary, skills, projects, education, experience, certifications, languages | Inter / Inter | projetos com o nome em negrito e as stacks na linha seguinte |
| transicao | summary, skills, projects, experience, education, certifications, languages | Source Sans 3 / Source Sans 3 | — |
| internacional | summary, experience, skills, projects, education, certifications, languages | Inter / Inter | `locationLine: true` (D-05) |

No `minimalista`, `projects` e `certifications` foram omitidos de propósito, como no PRD. A seção `highlights` tira os bullets destacados da experiência (D-03).

- [ ] **Passo 1: escrever os testes que falham** em `pdf-templates.test.ts`. O fixture completo `fullCv()` tem:
  - nome "Ana Souza", headline e contato `"ana@exemplo.test | +55 11 91234-5678 | São Paulo, SP | github.com/ana"`;
  - 2 experiências e 2 projetos;
  - 1 certificação e 2 idiomas;
  - `highlightKeys` com 1 bullet;
  - um resumo com "Ação, São, Español – Niño".

  Testes:
  - `it.each(CV_TEMPLATES)("%s: ordem legível pelo ATS", …)`:
    - o texto extraído tem os índices em ordem crescente: nome < headline < e-mail < cada `SECTION_LABELS.pt[s]` das `sections` do template;
    - compare sem diferenciar maiúsculas, porque o Compacto usa `uppercase`;
    - `/[\w.]+@[\w.]+/` e `/\+55 11 91234-5678/` casam;
    - `/\p{L}-\n\p{L}/u` não casa;
    - "Ação", "Español" e "Niño" aparecem.
  - `it.each(CV_TEMPLATES)("%s: perfil mínimo sem título vazio", …)`: um CV só com o nome não contém nenhum rótulo de `SECTION_LABELS.pt`.
  - **resultados:** o texto do bullet destacado aparece uma única vez, depois de "Destaques" e antes de "Experiência".
  - **internacional, com `lang: "en"`:** contém "Location: São Paulo, SP · Open to remote" e "Experience".
  - **Metadados** (`(await getDocumentProxy(...)).getMetadata()`): `info.Title === "CV Ana Souza"`, `info.Author === "Ana Souza"`, `info.Subject === headline`, e `info.Keywords` contém "React".
  - **Contraste:** para todo template com `accent`, a razão WCAG contra `#FFFFFF` é ≥ 4.5.
  - `getTemplate("nao-existe").id === "classico"` e `CV_TEMPLATES.length === 10`.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **Seções:** cada seção é uma função pura em `sections.tsx`, que devolve `null` sem dados. A filtragem de flagged, vazios e duplicados do `CvDocument` atual vai para um helper compartilhado.
  - **Estilos:** são criados por template com `StyleSheet.create`, a partir dos tokens.
  - **Competências agrupadas:** a linha é `"<Categoria>: a, b"`, com a categoria vinda de `normalizeSkill` e de `StackCategory`, e rótulos de categoria por idioma. O que não é stack conhecida vai para "Outras" / "Other" / "Otras".
  - **Linha de localização:** acrescente `location: string` ao `AssembledCv`, preenchida com `profile.location ?? ""` em `assembleCv`, e ajuste o teste da Tarefa 2.
  - **Metadados:** conforme D-08.
- [ ] **Passo 4:** rodar `pnpm vitest run tests/unit/client/pdf-templates.test.ts tests/unit/client/pdf.test.ts tests/unit/client/pdf-preview.test.tsx`, depois `pnpm typecheck && pnpm lint`. Esperado: PASS. Se a ordem extraída falhar num template, ajuste o token (por exemplo, a margem), não o teste.
- [ ] **Passo 5: commit** `feat(pdf): dez templates de CV de coluna única guiados por registro`

### Tarefa 5: recomendação, preferências e template por documento

**Arquivos:**
- Criar: `lib/client/pdf/templates/recommend.ts`, `lib/client/pdf/templates/prefs.ts`
- Modificar: `lib/client/cv/generated-store.ts`, `lib/client/storage/keys.ts`, `lib/client/storage/backup.ts`
- Teste: `tests/unit/client/cv-template-recommend.test.ts`, `tests/unit/client/backup.test.ts`

**Interfaces:**
- Usa: `CvTemplateId` e `getTemplate` (Tarefa 4), `Profile` v2 (Tarefa 1), `pickLanguage(job)` (`lib/client/ai/prompts/cv.tailor.v1.ts`).
- Entrega `recommendTemplate(profile: Profile, job: JobDetail | null): CvTemplateId`, com a regra e a ordem de D-06; `job === null` (CV base) conta como vaga em pt.
- Entrega `CvPrefs = z.object({ templateId: z.string().nullable() })` e `cvPrefsStore`, na chave `"jobfind:v1:cvPrefs"`, com `version 1` e `initial { templateId: null }`.
- Entrega `resolveTemplateId(recordTemplateId: string | null | undefined, prefs: CvPrefs, profile: Profile, job: JobDetail): CvTemplateId`. Um id inválido em qualquer nível passa para o nível seguinte.
- `GeneratedRecord` ganha `templateId: z.string().nullable()`, e `generatedStore` passa a `version: 2`, com `migrations: { 1: migrateGeneratedV1toV2 }`. A migração acrescenta `templateId: null` a cada registro.
- O `StorageKey` ganha `"jobfind:v1:cvPrefs"`, e o `BACKUP_KEYS` ganha `CV_PREFS`.

- [ ] **Passo 1: escrever os testes que falham.**
  - **Tabela de `recommendTemplate`:**
    - vaga em inglês com `senior` → `internacional`;
    - `lead` → `lideranca`;
    - `junior` → `inicio-de-carreira`;
    - sem experiências → `inicio-de-carreira`;
    - 1 projeto e experiência "Professora de matemática" sem stack → `transicao`;
    - `senior` em vaga pt → `resultados`;
    - `mid` → `classico`.
  - **`resolveTemplateId`:**
    - um registro `"harvard"` vence a preferência `"moderno"`;
    - registro `null` com preferência `"moderno"` → `moderno`;
    - registro `"xyz"` com preferência `null` → a recomendação.
  - **Store:** `{v:1,data:{"7":registroSemTemplateId}}` lido por `generatedStore.get()` traz `templateId === null` (o registro não some).
  - **Backup:**
    - exporta e importa `jobfind:v1:cvPrefs`;
    - importa um `generatedDocs` sem `templateId` com `ok: true`;
    - um `cvPrefs` com campo extra vai para `skipped`.
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.** Para "experiência cita stack", use `normalizeSkill` sobre as palavras do título e dos bullets. `validateKey(GENERATED)` aplica a migração do registro antes do schema estrito.
- [ ] **Passo 4:** rodar os testes, depois `pnpm test`, `pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(cv): recomendação de template, padrão do usuário e template por documento`

### Tarefa 6: seletor "Modelo do CV" no gerador

**Arquivos:**
- Criar: `components/generator/TemplatePicker.tsx`
- Modificar: `components/generator/GeneratorToolbar.tsx` (remover o comentário "só há um modelo"), `GeneratorScreen.tsx`, `PdfPreview.tsx`
- Teste: `tests/unit/client/template-picker.test.tsx`, `tests/e2e/generator.spec.ts`

**Interfaces:**
- Usa: `CV_TEMPLATES`, `getTemplate`, `recommendTemplate`, `resolveTemplateId`, `cvPrefsStore`, `GeneratedRecord.templateId`.
- Entrega `TemplatePicker({ value, recommended, onChange, showDefaultOption = true }: { value: CvTemplateId; recommended: CvTemplateId; onChange: (id: CvTemplateId, makeDefault: boolean) => void; showDefaultOption?: boolean })`.
- `PdfPreview` recebe a prop `templateId: CvTemplateId`.

- [ ] **Passo 1: escrever os testes que falham.**
  - **Unidade:**
    - o botão tem o nome acessível "Modelo do CV: Clássico";
    - ao clicar, abre um `dialog` com um `radiogroup` de 10 `radio`s;
    - o recomendado contém o texto "Recomendado para você";
    - cada item mostra a descrição e "Indicado para: …";
    - escolher "Harvard" com a caixa "Usar como padrão nos próximos CVs" marcada chama `onChange("harvard", true)`.
  - **E2E** em `generator.spec.ts`, com o fluxo e o provedor falso existentes:
    - depois de gerar, abrir "Modelo do CV" e escolher "Harvard";
    - o botão passa a "Modelo do CV: Harvard";
    - o provedor falso continua com o mesmo número de chamadas;
    - depois de `page.reload()`, continua "Harvard".
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **`GeneratorScreen`:** calcula `templateId = resolveTemplateId(record?.templateId ?? draftTemplate, prefs, profile, job)`.
    - Ao escolher, com registro: `update(r => ({ ...r, templateId: id }))`. Sem registro: guarda o id em `draftTemplate`, que é gravado no registro quando ele for criado.
    - Com `makeDefault`: `cvPrefsStore.set({ templateId: id })`.
  - **Uso do id:** a prévia e o download usam esse `templateId`.
  - **`TemplatePicker`:** usa o `Dialog` de `components/ui/dialog.tsx`, com alvos ≥ 44 px.
- [ ] **Passo 4:** rodar `pnpm vitest run tests/unit/client/template-picker.test.tsx tests/unit/client/pdf-preview.test.tsx` e `pnpm test:e2e tests/e2e/generator.spec.ts tests/e2e/mobile-generator.spec.ts`, depois `pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(gerador): seletor de modelo do CV com recomendação e padrão`

### Tarefa 7: editores do perfil v2, estrela de destaque e "Baixar CV base"

**Arquivos:**
- Criar: `components/profile/ProjectsEditor.tsx`, `CertificationsEditor.tsx`, `LanguagesEditor.tsx`, `BaseCvDownload.tsx`
- Modificar: `components/profile/ProfileEditor.tsx`, `ExperienceEditor.tsx`, `ProfileScreen.tsx`
- Teste: `tests/unit/client/profile-editors.test.tsx`, `tests/e2e/profile.spec.ts`

**Interfaces:**
- Usa: `Profile` v2, `MAX_HIGHLIGHTS`, `LANGUAGE_LEVELS`, `LANGUAGE_LEVEL_LABEL.pt`, `assembleBaseCv`, `renderCvPdf`, `TemplatePicker` (com `showDefaultOption={false}`), `recommendTemplate(profile, null)`.
- `ExperienceEditor` ganha as props `highlights: string[]` e `onHighlightsChange: (ids: string[]) => void`.

- [ ] **Passo 1: escrever os testes que falham.**
  - **`ProjectsEditor`:**
    - "Adicionar projeto" cria `proj_1`, e o segundo projeto vira `proj_2`;
    - "Adicionar bullet" cria `proj_1.b1`;
    - o texto de ajuda "Escreva os projetos no idioma em que vai se candidatar" aparece.
  - **`LanguagesEditor`:** o `select` de nível tem as 5 opções em pt ("Básico" … "Nativo").
  - **`CertificationsEditor`:** emissor e ano vazios gravam `null`.
  - **Estrela do `ExperienceEditor`:**
    - o botão "Destacar no CV" tem `aria-pressed` e alterna o id em `highlights`;
    - com 3 destaques, as outras estrelas ficam `disabled` e aparece "Máximo de 3 destaques";
    - apagar um bullet destacado remove o id de `highlights`.
  - **`BaseCvDownload`:** clicar em "Baixar CV base" chama `renderCvPdf` (mock) com o template escolhido.
  - **E2E** em `profile.spec.ts`:
    - adicionar o projeto "Job Find", a certificação "AWS SAA" e o idioma "Inglês – Fluente";
    - salvar e recarregar;
    - os três continuam lá.
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.** Siga a aparência e os padrões do `ExperienceEditor` e do `EducationEditor`:
  - `FIELD`, `FIELD_LABEL`, botões de remover com `aria-label`;
  - as mudanças passam pelo `patch` do `ProfileEditor`, para manter o aviso de alterações não salvas.
- [ ] **Passo 4:** rodar os testes de unidade e `pnpm test:e2e tests/e2e/profile.spec.ts`, depois `pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(perfil): editores de projetos, certificações e idiomas, destaques e CV base`

### Tarefa 8: verificação final

- [ ] **Passo 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Esperado: tudo verde.
- [ ] **Passo 2:** `pnpm test:e2e`. Esperado: tudo verde.
- [ ] **Passo 3:** medir a geração do PDF (RNF-11) no navegador com o perfil fictício, num template de cada família de fonte, e anotar os tempos para o PR.
- [ ] **Passo 4:** se houver correção, commit `fix: ajustes da verificação final da Fase 2`.
