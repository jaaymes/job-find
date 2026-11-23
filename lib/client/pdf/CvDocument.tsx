import "client-only";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import type { CvLang } from "@/lib/client/cv/period";
import { PDF_FONT } from "./fonts";

export const SECTION_LABELS: Record<CvLang, { summary: string; experience: string; skills: string; education: string }> = {
  pt: { summary: "Resumo", experience: "Experiência", skills: "Competências", education: "Formação" },
  en: { summary: "Summary", experience: "Experience", skills: "Skills", education: "Education" },
  es: { summary: "Resumen", experience: "Experiencia", skills: "Habilidades", education: "Educación" },
};

export const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 10, lineHeight: 1.4, paddingVertical: 40, paddingHorizontal: 44, color: "#111111" },
  name: { fontSize: 20, fontWeight: 700 },
  headline: { fontSize: 11.5, marginTop: 4 },
  contact: { fontSize: 9, marginTop: 4, color: "#333333" },
  section: { marginTop: 12 },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottomWidth: 0.75, borderBottomColor: "#111111", paddingBottom: 2, marginBottom: 5 },
  job: { marginBottom: 7 },
  jobTitle: { fontWeight: 700 },
  jobMeta: { fontSize: 9, color: "#333333", marginBottom: 2 },
  bullet: { marginLeft: 10, marginBottom: 1.5 },
  paragraph: { marginBottom: 6 },
});

/** CV de coluna única: só texto, sem tabela nem imagem. Trechos com `flagged` ficam de fora; seção vazia não aparece. */
export function CvDocument({ cv }: { cv: AssembledCv }) {
  const L = SECTION_LABELS[cv.lang];
  const headline = cv.flags.headline.flagged ? "" : cv.headline;
  const summary = cv.flags.summary.flagged ? "" : cv.summary;
  const skills = cv.skills.filter((_, i) => !cv.flags.skills[i]?.flagged);
  const experiences = cv.experiences
    .map((x) => ({ ...x, bullets: x.bullets.filter((b) => !b.flagged) }))
    .filter((x) => x.bullets.length > 0 || x.company || x.role);
  const education = cv.education.filter(Boolean);
  return (
    <Document title={cv.name ? `CV ${cv.name}` : "CV"} author={cv.name || undefined}>
      <Page size="A4" style={styles.page}>
        <View>
          {cv.name ? <Text style={styles.name}>{cv.name}</Text> : null}
          {headline ? <Text style={styles.headline}>{headline}</Text> : null}
          {cv.contactLine ? <Text style={styles.contact}>{cv.contactLine}</Text> : null}
        </View>
        {summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{L.summary}</Text>
            <Text>{summary}</Text>
          </View>
        ) : null}
        {experiences.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{L.experience}</Text>
            {experiences.map((x, i) => (
              <View key={`${x.expId}@${x.occurrence}-${i}`} style={styles.job}>
                <Text style={styles.jobTitle}>{[x.role, x.company].filter(Boolean).join(" – ")}</Text>
                {x.period ? <Text style={styles.jobMeta}>{x.period}</Text> : null}
                {x.bullets.map((b) => (
                  <Text key={b.key} style={styles.bullet}>
                    {`- ${b.text}`}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}
        {skills.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{L.skills}</Text>
            <Text>{skills.join(", ")}</Text>
          </View>
        ) : null}
        {education.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{L.education}</Text>
            {education.map((e) => (
              <Text key={e} style={styles.paragraph}>
                {e}
              </Text>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
