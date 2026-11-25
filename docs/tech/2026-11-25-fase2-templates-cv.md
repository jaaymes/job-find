# Spec técnica: Fase 2. Dez templates de CV para ATS e perfil v2

- **Data:** 2026-11-25
- **Origem:** [PRD 2026-11-25](../prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md), Fase 2.
  - **Must:** RF-30..36, RNF-10..12, RN-30..32.
  - **Should:** RF-37 (CV base pelo perfil).
- **Fica fora:** RF-38, as miniaturas PNG (ver D-10).
- **Tamanho:** médio, só front-end. Não há rota, tabela nem contrato de API de servidor novos.
- **Especialistas:** não houve convocação em paralelo. Tudo fica em módulos de cliente que já seguem padrões repetidos no código: `createStore` com migrações, `@react-pdf/renderer` e os editores do perfil. O único ponto sensível de segurança é a importação de backup, que já tem validação estrita e só ganha a migração.

## 1. Como o código está hoje (fatos)

- **Layout do CV.** Há um layout único, `lib/client/pdf/CvDocument.tsx`:
  - recebe `AssembledCv`;
  - usa a família Inter, registrada em `lib/client/pdf/fonts.ts` com `Font.register` e `/fonts/*.ttf`;
  - tem a hifenização desligada;
  - os rótulos de seção ficam em `SECTION_LABELS` (pt/en/es), só com Resumo, Experiência, Competências e Formação;
  - o `Document` recebe apenas `title` e `author`.
- **`AssembledCv`** (`lib/client/cv/assemble.ts`):
  - junta perfil e texto da IA (RN-07, camada 1);
  - já tem `certifications: string[]`, sempre vazio;
  - os bullets montados não guardam os `sourceBulletIds`.
- **Renderização** (`lib/client/pdf/render.tsx`): `renderCvPdf(cv, fontsDir?)` e `renderLetterPdf`. O gerador chama esse módulo em dois lugares:
  - na pré-visualização (`components/generator/PdfPreview.tsx:160`, com debounce de 500 ms);
  - no download (`GeneratorScreen.tsx`, função `download`).
- **Teste de extração.** `tests/unit/client/pdf.test.ts` já roda em node, com `unpdf` e `FONTS = public/fonts`. É a base do RNF-10.
- **Perfil** (`lib/shared/schemas/profile.ts`):
  - `PROFILE_SCHEMA_VERSION = 1`, com `schemaVersion: z.literal(1)`;
  - a store fica em `lib/client/profile/store.ts`: `createStore("jobfind:v1:profile", …, { version: 1 })`;
  - `createStore` já executa `migrations[n]` de vN para vN+1 antes do `safeParse` (`lib/client/storage/store.ts:48-60`).
- **Prompt de extração** (`profile.extract.v1.ts`): usa `Profile` como schema estrito (`json_schema`) e diz "schemaVersion é sempre 1".
- **Documentos gerados** (`lib/client/cv/generated-store.ts`):
  - `GeneratedRecord` é validado registro a registro;
  - um campo obrigatório novo sem migração faria os registros antigos sumirem.
- **Backup** (`lib/client/storage/backup.ts`):
  - valida cada chave com `strictify(schema)`, sem passar pelas migrações da store;
  - um backup exportado hoje (perfil v1) seria rejeitado depois da mudança para v2.
- **Gerador.** `GeneratorToolbar.tsx` não tem seletor de modelo; um comentário explica que "só há um modelo". Para escolher o idioma, `pickLanguage(job)` fica em `lib/client/ai/prompts/cv.tailor.v1.ts:28`.
- **Stacks.** `lib/shared/stacks.ts` tem `StackCategory` (frontend, backend, mobile, data, devops, qa, lang, other), que pode agrupar competências.
- **Fixtures dos E2E.** Gravam o perfil com `schemaVersion: 1`. Depois da mudança, elas passam a exercitar a migração v1 → v2 também.

## 2. Decisões

### D-01. Perfil v2: campos novos e migração automática (RF-34)

- `PROFILE_SCHEMA_VERSION = 2`. Campos novos, todos obrigatórios e `nullable` onde couber, porque o schema volta a ser o `json_schema` estrito da extração:
  - `projects: { id: string /* proj_N */, name: string, link: string | null, stacks: string[], bullets: { id: string /* proj_N.bM */, text: string }[] }[]`
  - `certifications: { name: string, issuer: string | null, year: string | null }[]`
  - `languages: { name: string, level: "basic" | "intermediate" | "advanced" | "fluent" | "native" }[]`
  - `highlights: string[]`: ids `exp_N.bM` de no máximo 3 bullets marcados com estrela (template `resultados`).
- **Ruling:** os destaques ficam numa lista no topo do perfil, e não como `highlight: boolean` em cada bullet.
  - **Motivo:** o bullet `{ id, text }` é criado em vários lugares (editor, extração, fixtures, testes). Com a lista, a mudança fica num só ponto, e a IA de extração devolve `[]` sem esforço.
  - **Custo se estiver errado:** ids órfãos depois de apagar um bullet. Para isso, o editor e a montagem filtram ids inexistentes.
- **Migração `migrateProfileV1toV2(old: unknown): unknown`**, em `lib/shared/schemas/profile.ts`:
  - acrescenta listas vazias e `schemaVersion: 2`;
  - quando o valor não é um objeto, devolve-o como veio (o `safeParse` cuida disso).
- **Onde a migração é usada:**
  - `profileStore` passa a `version: 2`, com `migrations: { 1: migrateProfileV1toV2 }`;
  - a importação de backup aplica a migração antes do `strict.profile` (D-07);
  - `profile.extract.v1` vira `profile.extract.v2`: o schema v2, "schemaVersion é sempre 2", instruções para projetos, certificações e idiomas, e `highlights` sempre `[]`. O `import.ts` aponta para o v2. O arquivo v1 é apagado, porque não tem outro consumidor.
- **Editores novos** em `components/profile/`:
  - `ProjectsEditor.tsx` copia o padrão do `ExperienceEditor`;
  - `CertificationsEditor.tsx` e `LanguagesEditor.tsx` são listas simples, com a mesma aparência do `EducationEditor`.
  - No `ExperienceEditor`, cada bullet ganha um botão-estrela: `aria-pressed`, rótulo "Destacar no CV" e alvo ≥ 44 px. Ele fica desabilitado quando já há 3 destaques, com o texto "Máximo de 3 destaques".
- **Rótulos de nível** (`LANGUAGE_LEVEL_LABEL`): pt "Básico, Intermediário, Avançado, Fluente, Nativo"; en "Basic, Intermediate, Advanced, Fluent, Native"; es "Básico, Intermedio, Avanzado, Fluido, Nativo".
- O campo `englishLevel` continua como está (é usado no score de chance). A migração não cria entrada em `languages` a partir dele, porque o PRD pede listas vazias.

### D-02. Registro de templates guiado por dados (RF-30, RF-31)

- `lib/client/pdf/templates/registry.ts` exporta `CV_TEMPLATES: readonly CvTemplate[]` (10 itens, na ordem da seção 11.2 do PRD) e `getTemplate(id: string): CvTemplate`. Um id desconhecido cai em `classico`.
- Tipo, em `lib/client/pdf/templates/types.ts`:

  ```ts
  type CvSectionId = "summary" | "highlights" | "skills" | "experience" | "projects" | "education" | "certifications" | "languages";
  type CvTemplate = {
    id: CvTemplateId; name: string; description: string; bestFor: string;
    sections: CvSectionId[];             // ordem do template; seção sem dados não aparece
    font: { body: PdfFamily; headings: PdfFamily };
    tokens: { baseSize: number; nameSize: number; margins: { v: number; h: number }; sectionGap: number;
              titleCase: "normal" | "upper"; titleRule: boolean; accent: string /* RN-32 */; nameAlign: "left" | "center" };
    skillsLayout: "inline" | "grouped";  // grouped = por StackCategory (compacto)
    locationLine: boolean;               // internacional: "Location: …" (ver D-05)
  };
  ```

- **Ruling:** todos os templates usam os títulos padrão de `SECTION_LABELS`. Assim "Áreas de atuação" (Liderança) e "Competências relevantes" (Transição) viram "Competências".
  - **Motivo:** a RN-30 exige títulos padrão, e o ATS reconhece "Competências/Skills". O que diferencia os templates é a ordem, a tipografia, a densidade e a forma de apresentar as competências.
  - **Custo se estiver errado:** trocar um rótulo no registro.
- **Versalete do Compacto:** o `@react-pdf` não tem `font-variant: small-caps`, então vira `textTransform: "uppercase"` com `letterSpacing: 0.5`.
- `CvDocument({ cv, templateId })` passa a montar as seções pelo `template.sections`. Cada seção vira uma função pura `(cv, template, labels) => ReactElement | null`, em `lib/client/pdf/templates/sections.tsx`, que devolve `null` sem dados (US-07, sem título vazio).
- **Regras da RN-30 que não mudam:** coluna única, sem `fixed`, sem `Image`, sem tabela, nome como primeira linha, contato em texto simples no corpo e a margem mínima de 8 entre nome e título (bug de ATS já corrigido).
- **Cor de acento** (RN-32): só nos títulos e nas linhas. Os valores ficam no registro, e um teste unitário verifica contraste ≥ 4.5:1 sobre branco com a fórmula de luminância relativa da WCAG.

### D-03. Montagem: dados novos no `AssembledCv` (RF-35, template 6)

- Os bullets ganham `sources: string[]`, os `sourceBulletIds` de `TailoredDocs`.
- `AssembledCv` ganha:
  - `projects: { name: string; link: string | null; stacks: string[]; bullets: string[] }[]`;
  - `certifications: string[]`, no formato `"Nome – Emissor (Ano)"`;
  - `languages: string[]`, no formato `"Inglês – Fluente"`, com o nível rotulado no idioma do CV;
  - `highlightKeys: string[]`: as `key` dos bullets montados cujo `sources` cruza com `profile.highlights`, no máximo 3, na ordem do CV;
  - `headline` continua como está; `targetRole` (para o `subject` do PDF) usa o `headline`.
- **Projetos, certificações e idiomas** vêm do perfil como estão, sem passar pela IA (RN-07, camada 1).
- **Premissa P-F2-01:** os bullets de projeto aparecem no idioma em que foram escritos no perfil. A adaptação de projetos pela IA não entra nesta fase. Exigiria mudar `TailoredDocs`, o validador e o prompt `cv.tailor`, e o PRD não pede isso.
- **Seção "Destaques"** (template `resultados`):
  - mostra os bullets de `highlightKeys` com " (Empresa)" no fim e tira esses mesmos bullets da experiência, para não repetir texto;
  - um bullet `flagged` nunca entra;
  - sem destaques, a seção não aparece.
- **Rótulos novos** em `SECTION_LABELS`, em pt/en/es: `projects`, `certifications`, `languages` e `highlights` ("Destaques" / "Key achievements" / "Logros destacados").

### D-04. Fontes sob demanda e subconjunto latino (RF-36, R-06)

- **Famílias:** a Inter, que já existe, mais Source Serif 4, JF Sans e JF Grotesk, em regular 400 e bold 700, TTF estático, licença OFL.
- **Origem:** os repositórios oficiais (google/fonts, adobe-fonts e IBM/plex). As licenças ficam em `public/fonts/LICENSE-<Família>.txt`.
- **Subconjunto:** `pyftsubset` (fonttools, só na máquina de quem gera e nunca em runtime) com Basic Latin, Latin-1 Supplement, Latin Extended-A, pontuação geral e os símbolos `–—•·€£`. Isso cobre pt/en/es. O script fica em `scripts/subset-fonts.sh`, para ser reproduzível.
  - **Meta:** fontes novas ≤ 1,5 MB no total (teste lê o tamanho dos arquivos).
  - **Estimativa:** cerca de 60 a 120 KB por arquivo depois do subconjunto.
- **Registro:** `registerPdfFonts` registra as 4 famílias de uma vez. O `@react-pdf` só busca o arquivo de uma família quando um texto a usa, então o template escolhido só baixa as próprias fontes. A hifenização continua desligada.
- **Sem dependência npm nova.** Os TTF são versionados como hoje.

### D-05. Template Internacional

- Rótulos sempre no idioma do CV. Com o CV em inglês, a linha de contato ganha "Location: <cidade do perfil> · Open to remote", em texto simples logo abaixo do contato. Ela só aparece se `profile.location` existir.
- Não mostra dados pessoais além do contato. O perfil não tem esses dados de qualquer forma.
- Página A4. O tamanho Carta fica fora (é Could no PRD).

### D-06. Preferência e template por documento (RF-32, RF-33, RN-31)

- **Nova store `jobfind:v1:cvPrefs`**, com `{ templateId: CvTemplateId | null }` e `version 1`, em `lib/client/pdf/templates/prefs.ts`. Ela é incluída no `BACKUP_KEYS`.
- **`GeneratedRecord` ganha `templateId: string | null`:**
  - a store passa a `version 2`, com a migração `1 → 2` que acrescenta `templateId: null`;
  - `null` significa "usa a preferência, depois a recomendação". Por isso um CV já gerado abre no padrão do usuário ou no `classico`, e nunca some.
- **Resolução**, em `resolveTemplateId(record, prefs, profile, job): CvTemplateId`: `record.templateId` → `prefs.templateId` → `recommendTemplate(profile, job)`.
- **`recommendTemplate`** é pura e fica em `lib/client/pdf/templates/recommend.ts`. Implementa a RN-31, nesta ordem:
  1. vaga com `pickLanguage(job) === "en"` → `internacional`;
  2. `seniority === "lead"` → `lideranca`;
  3. `seniority === "junior"` ou nenhuma experiência → `inicio-de-carreira`;
  4. projetos ≥ 1 e nenhuma experiência cita uma stack do dicionário (título ou bullets, via `normalizeSkill`) → `transicao`;
  5. `senior` → `resultados`;
  6. senão → `classico`.
- **Ruling sobre a ordem:** idioma antes de senioridade, porque um CV para vaga em inglês precisa dos rótulos e da linha de localização, qualquer que seja o nível. O PRD lista as regras sem ordem.
- **Seletor "Modelo do CV"**, novo `components/generator/TemplatePicker.tsx`:
  - um botão na `GeneratorToolbar` ("Modelo: Clássico", alvo ≥ 44 px) abre o `Dialog` já existente (`components/ui/dialog.tsx`);
  - o diálogo tem um `radiogroup` com os 10 itens (nome, descrição, "Indicado para"), e o recomendado recebe o selo "Recomendado para você";
  - há uma caixa "Usar como padrão nos próximos CVs";
  - escolher grava `record.templateId` (ou o rascunho, se ainda não há registro) e, com a caixa marcada, `cvPrefs`.
  - Não há chamada à IA: `PdfPreview` recebe `templateId` e só renderiza de novo.
- `renderCvPdf(cv, templateId, fontsDir?)` passa a receber o `templateId`. O download usa o mesmo id da prévia.

### D-07. Backup

- `validateKey(PROFILE)` aplica `migrateProfileV1toV2` quando `schemaVersion === 1`, antes do schema estrito. `validateKey(GENERATED)` aplica a migração do registro. Assim backups v1 continuam importáveis (PRD, "Rollout").
- Nova chave `CV_PREFS` com o schema estrito.
- `BACKUP_VERSION` não muda: o envelope é o mesmo, e chaves desconhecidas já são ignoradas.

### D-08. Metadados do PDF (RNF-12)

`<Document>` recebe:

- `title`: "CV <nome>";
- `author`: o nome;
- `subject`: o headline;
- `keywords`: as skills não sinalizadas, separadas por vírgula;
- `creator` e `producer`: "Job Find".

Um teste unitário lê os metadados com `getDocumentProxy(...).getMetadata()`.

### D-09. CV base pelo perfil (RF-37, Should)

- `assembleBaseCv(profile, lang): AssembledCv`, em `lib/client/cv/assemble.ts`, monta o CV sem vaga:
  - `TailoredDocs` sintético com o headline, o resumo, as skills na ordem do perfil e as experiências com os bullets originais;
  - os `sources` apontam para o próprio bullet;
  - não há `flags`.
- Na tela do perfil (`ProfileScreen.tsx`), o card "Baixar CV base" tem um seletor de template, que reusa o `TemplatePicker` em modo compacto, e um seletor de idioma, só para os rótulos.
- A carga do renderizador continua por `import()`.

### D-10. Fora desta fase

- **RF-38 (miniaturas):** exige renderizar PDF para PNG em node (canvas nativo), uma dependência nova pesada só para imagens. O seletor mostra nome, descrição e "Indicado para", e a prévia real do PDF atualiza na hora em que o usuário escolhe. Reavaliar depois do uso.
- **Q-04 (teste em ATS real):** continua aberta. A validação é sintética (RNF-10).

## 3. Testes e critério de pronto

| Requisito | Teste |
|---|---|
| RNF-10 | `tests/unit/client/pdf-templates.test.ts` (node), `it.each(CV_TEMPLATES)` com um fixture completo (projetos, certificações, idiomas e destaques). Verifica a ordem nome → título → contato → títulos das seções na ordem do template; e-mail e telefone por regex; nenhuma palavra hifenizada (`/\w-\n\w/`); e ausência de rótulo de seção vazia num perfil sem projetos. |
| RNF-12 | Metadados no mesmo arquivo. |
| RN-31 | `tests/unit/client/cv-template-recommend.test.ts`, com tabela de casos. |
| RN-32 | Contraste dos acentos do registro ≥ 4.5. |
| RF-34 | `tests/unit/client/profile-migration.test.ts`: v1 → v2 pela store e pelo backup; perfil inválido continua caindo no `initial`. |
| RF-33 | Teste de `resolveTemplateId` e da migração do `GeneratedRecord`; backup exporta e importa `cvPrefs`. |
| RF-36 | Soma dos tamanhos dos TTF novos ≤ 1,5 MB; cada família com `LICENSE-*.txt`. |
| RF-32 | E2E `tests/e2e/generator.spec.ts`: abrir "Modelo", escolher "Harvard", ver o título do botão mudar sem nova requisição ao provedor falso, recarregar e continuar Harvard. Com "Usar como padrão", outra vaga abre em Harvard. |
| RF-34 (UI) | E2E `tests/e2e/profile.spec.ts`: adicionar projeto, certificação e idioma, salvar, recarregar e os dados continuam. |
| RNF-11 | Medição manual com o perfil fictício (≤ 2 s); registrar o tempo no PR. |

**Verificação final:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, mais os E2E de gerador e perfil.

## 4. Fases do plano (ordem e dependências)

1. **Perfil v2:** schema, migração, store, backup e prompt de extração v2. É a base de tudo.
2. **Montagem:** `sources`, projetos, certificações, idiomas e destaques no `AssembledCv`, mais `assembleBaseCv`. Depende de 1.
3. **Fontes:** subconjunto, licenças e `registerPdfFonts`. É independente, pode correr em paralelo com 1 e 2.
4. **Registro e renderizador:** `CvDocument` guiado por template, os 10 templates, metadados e o teste RNF-10. Depende de 2 e 3.
5. **Recomendação e preferências:** `recommendTemplate`, `cvPrefs`, migração do `GeneratedRecord` e `resolveTemplateId`. Depende de 1.
6. **UI do gerador:** `TemplatePicker`, toolbar, prévia e download. Depende de 4 e 5.
7. **UI do perfil:** editores de projetos, certificações e idiomas, estrela de destaque e "Baixar CV base". Depende de 1, 4 e 6 (reusa o picker).
8. **E2E e verificação final.**

## 5. Riscos

| Risco | Prob./Impacto | Mitigação |
|---|---|---|
| Migração v2 apaga perfis (o `safeParse` falha e cai no `initial = null`) | Baixa / Alto | Teste com fixtures v1 reais, incluindo os dos E2E; a migração só acrescenta campos |
| Backup antigo rejeitado | Média / Médio | D-07, com teste de importação de um arquivo v1 |
| Fontes acima de 1,5 MB | Baixa / Baixo | Subconjunto latino, com teste de tamanho |
| Ordem do texto extraído diferente da visual com `uppercase` ou nome centralizado | Média / Médio | O teste RNF-10 cobre cada template; se falhar, o token muda, não o teste |
| Dez templates parecidos demais (R-05) | Média / Baixo | Diferenciar ordem, tipografia e densidade; a prévia real no seletor |

## 6. Perguntas em aberto

Nenhuma. Respostas do PO em 2026-11-25:

- **Q-F2-01:** os bullets de projeto aparecem como foram escritos no perfil (P-F2-01). O editor de projetos mostra o texto de ajuda "Escreva os projetos no idioma em que vai se candidatar".
- **Downloads:** liberado baixar as fontes OFL dos repositórios oficiais e o fonttools num venv temporário (D-04).
