import "client-only";

import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { styles } from "./CvDocument";

/** Carta de coluna única: cabeçalho com nome e contato do CV, depois os parágrafos da carta (já decidida pelo chamador). */
export function CoverLetterDocument({ letter, cv }: { letter: string; cv: AssembledCv }) {
  const paragraphs = letter
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  return (
    <Document title={cv.name ? `Carta ${cv.name}` : "Carta"} author={cv.name || undefined}>
      <Page size="A4" style={{ ...styles.page, fontSize: 11, lineHeight: 1.5 }}>
        <View style={{ marginBottom: 18 }}>
          {cv.name ? <Text style={styles.name}>{cv.name}</Text> : null}
          {cv.contactLine ? <Text style={styles.contact}>{cv.contactLine}</Text> : null}
        </View>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>
            {p}
          </Text>
        ))}
      </Page>
    </Document>
  );
}
