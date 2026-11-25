import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { normalizeSkill, STACKS, type StackCategory } from "@/lib/shared/stacks";
import { CATEGORY_LABELS, SECTION_LABELS } from "../labels";
import type { CvSectionId, CvTemplate } from "./types";

const hasText = (s: string) => s.trim().length > 0;

type Exp = AssembledCv["experiences"][number];

/** Experiência repetida (`occurrence > 0`) ou com violação de nível de experiência: não entra no PDF. */
function isDuplicateOrInvalid(x: Exp): boolean {
  if (x.occurrence > 0) return true;
  return x.bullets.some((b) => b.violations.some((v) => v.kind === "unknown_exp" && v.where.bulletIndex === undefined));
}

/** CV já filtrado (sem flagged, vazios e duplicados), compartilhado por todas as seções. */
export type CleanCv = {
  name: string;
  headline: string;
  summary: string;
  skills: string[];
  experiences: Exp[];
  highlights: { key: string; text: string; company: string }[];
  education: string[];
  projects: AssembledCv["projects"];
  certifications: string[];
  languages: string[];
};

export function cleanCv(cv: AssembledCv, withHighlights: boolean): CleanCv {
  const headline = cv.flags.headline.flagged || !hasText(cv.headline) ? "" : cv.headline.trim();
  const summary = cv.flags.summary.flagged || !hasText(cv.summary) ? "" : cv.summary.trim();
  const skills = cv.skills.filter((s, i) => !cv.flags.skills[i]?.flagged && hasText(s)).map((s) => s.trim());
  const valid = cv.experiences
    .filter((x) => !isDuplicateOrInvalid(x))
    .map((x) => ({ ...x, bullets: x.bullets.filter((b) => !b.flagged && hasText(b.text)) }));
  const keys = new Set(cv.highlightKeys);
  const highlights: CleanCv["highlights"] = [];
  if (withHighlights) {
    for (const x of valid) for (const b of x.bullets) if (keys.has(b.key)) highlights.push({ key: b.key, text: b.text.trim(), company: x.company });
  }
  const experiences = valid
    .map((x) => (withHighlights ? { ...x, bullets: x.bullets.filter((b) => !keys.has(b.key)) } : x))
    .filter((x) => x.bullets.length > 0 || x.company || x.role);
  return {
    name: cv.name,
    headline,
    summary,
    skills,
    experiences,
    highlights,
    education: cv.education.filter(hasText),
    projects: cv.projects
      .map((p) => ({ ...p, bullets: p.bullets.filter(hasText) }))
      .filter((p) => hasText(p.name)),
    certifications: cv.certifications.filter(hasText),
    languages: cv.languages.filter(hasText),
  };
}

export type CvStyles = ReturnType<typeof buildStyles>;

export function buildStyles(t: CvTemplate) {
  const k = t.tokens;
  const upper = k.titleCase === "upper";
  return StyleSheet.create({
    page: {
      fontFamily: t.font.body,
      fontSize: k.baseSize,
      lineHeight: 1.4,
      paddingVertical: k.margins.v,
      paddingHorizontal: k.margins.h,
      color: "#111111",
    },
    header: { textAlign: k.nameAlign },
    name: { fontFamily: t.font.headings, fontSize: k.nameSize, fontWeight: 700 },
    // Margem de 8: com menos (4), o extrator de texto (ATS) cola nome e título ("Ana SouzaDev").
    headline: { fontSize: k.baseSize + 1.5, marginTop: 8 },
    contact: { fontSize: k.baseSize - 1, marginTop: 4, color: "#333333" },
    section: { marginTop: k.sectionGap },
    sectionTitle: {
      fontFamily: t.font.headings,
      fontSize: k.baseSize + 1,
      fontWeight: 700,
      color: k.accent,
      textTransform: upper ? "uppercase" : undefined,
      letterSpacing: upper ? 0.5 : undefined,
      ...(k.titleRule ? { borderBottomWidth: 0.75, borderBottomColor: k.accent, paddingBottom: 2 } : {}),
      marginBottom: 5,
    },
    job: { marginBottom: 7 },
    jobTitle: { fontWeight: 700 },
    jobMeta: { fontSize: k.baseSize - 1, color: "#333333", marginBottom: 2 },
    bullet: { marginLeft: 10, marginBottom: 1.5 },
    highlight: { marginLeft: 10, marginBottom: 2, fontWeight: t.boldHighlights ? 700 : 400 },
    paragraph: { marginBottom: 6 },
    projectName: { fontWeight: 700 },
  });
}

type Ctx = { cv: AssembledCv; clean: CleanCv; t: CvTemplate; s: CvStyles };
type SectionFn = (c: Ctx) => ReactElement | null;

const L = (c: Ctx) => SECTION_LABELS[c.cv.lang];

function Section({ c, id, children }: { c: Ctx; id: CvSectionId; children: ReactElement | ReactElement[] }) {
  return (
    <View style={c.s.section}>
      <Text style={c.s.sectionTitle}>{L(c)[id]}</Text>
      {children}
    </View>
  );
}

const STACK_CATEGORY = new Map(STACKS.map((d) => [d.id, d.category]));

/** `"<Categoria>: a, b"`; o que não é stack conhecida vai para "Outras". */
function groupedSkills(skills: string[], lang: AssembledCv["lang"]): string[] {
  const labels = CATEGORY_LABELS[lang];
  const groups = new Map<StackCategory, string[]>();
  for (const sk of skills) {
    const id = normalizeSkill(sk);
    const cat: StackCategory = (id && STACK_CATEGORY.get(id)) || "other";
    groups.set(cat, [...(groups.get(cat) ?? []), sk]);
  }
  const order = Object.keys(labels) as StackCategory[];
  return order.filter((k) => groups.has(k)).map((k) => `${labels[k]}: ${groups.get(k)?.join(", ")}`);
}

const SECTIONS: Record<CvSectionId, SectionFn> = {
  summary: (c) =>
    c.clean.summary ? (
      <Section c={c} id="summary">
        <Text>{c.clean.summary}</Text>
      </Section>
    ) : null,
  highlights: (c) =>
    c.clean.highlights.length > 0 ? (
      <Section c={c} id="highlights">
        {c.clean.highlights.map((h) => (
          <Text key={h.key} style={c.s.highlight}>
            {`- ${h.text}${h.company ? ` (${h.company})` : ""}`}
          </Text>
        ))}
      </Section>
    ) : null,
  skills: (c) => {
    if (c.clean.skills.length === 0) return null;
    return (
      <Section c={c} id="skills">
        {c.t.skillsLayout === "grouped" ? (
          <View>
            {groupedSkills(c.clean.skills, c.cv.lang).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </View>
        ) : (
          <Text>{c.clean.skills.join(", ")}</Text>
        )}
      </Section>
    );
  },
  experience: (c) =>
    c.clean.experiences.length > 0 ? (
      <Section c={c} id="experience">
        {c.clean.experiences.map((x, i) => (
          <View key={`${x.expId}@${x.occurrence}-${i}`} style={c.s.job}>
            <Text style={c.s.jobTitle}>{[x.role, x.company].filter(Boolean).join(" – ")}</Text>
            {x.period ? <Text style={c.s.jobMeta}>{x.period}</Text> : null}
            {x.bullets.map((b) => (
              <Text key={b.key} style={c.s.bullet}>
                {`- ${b.text}`}
              </Text>
            ))}
          </View>
        ))}
      </Section>
    ) : null,
  projects: (c) =>
    c.clean.projects.length > 0 ? (
      <Section c={c} id="projects">
        {c.clean.projects.map((p, i) => {
          const stacks = p.stacks.filter(hasText).join(", ");
          const own = c.t.projectStacksOnOwnLine === true;
          const title = own ? p.name : [p.name, stacks].filter(Boolean).join(" – ");
          return (
            <View key={`${p.name}-${i}`} style={c.s.job}>
              <Text style={own ? c.s.projectName : c.s.jobTitle}>{title}</Text>
              {own && stacks ? <Text style={c.s.jobMeta}>{stacks}</Text> : null}
              {p.link ? <Text style={c.s.jobMeta}>{p.link}</Text> : null}
              {p.bullets.map((b) => (
                <Text key={b} style={c.s.bullet}>
                  {`- ${b}`}
                </Text>
              ))}
            </View>
          );
        })}
      </Section>
    ) : null,
  education: (c) =>
    c.clean.education.length > 0 ? (
      <Section c={c} id="education">
        {c.clean.education.map((e) => (
          <Text key={e} style={c.s.paragraph}>
            {e}
          </Text>
        ))}
      </Section>
    ) : null,
  certifications: (c) =>
    c.clean.certifications.length > 0 ? (
      <Section c={c} id="certifications">
        {c.clean.certifications.map((e) => (
          <Text key={e} style={c.s.paragraph}>
            {e}
          </Text>
        ))}
      </Section>
    ) : null,
  languages: (c) =>
    c.clean.languages.length > 0 ? (
      <Section c={c} id="languages">
        {c.clean.languages.map((e) => (
          <Text key={e} style={c.s.paragraph}>
            {e}
          </Text>
        ))}
      </Section>
    ) : null,
};

export function renderSection(id: CvSectionId, c: Ctx): ReactElement | null {
  return SECTIONS[id](c);
}

/** D-05: só no CV em inglês, e só se o perfil tem localização. */
export function locationLine(cv: AssembledCv): string | null {
  if (cv.lang !== "en" || !hasText(cv.location)) return null;
  return `Location: ${cv.location.trim()} · Open to remote`;
}
