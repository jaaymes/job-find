import "client-only";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { toNfc } from "@/lib/client/cv/nfc";
import { PDF_FONT } from "./fonts";
import { getTemplate } from "./templates/registry";
import { buildStyles, cleanCv, locationLine, renderSection } from "./templates/sections";
import type { CvTemplateId } from "./templates/types";

export { SECTION_LABELS } from "./labels";

/** Estilos base da carta de apresentação (o CV usa os estilos por template, em `templates/sections.tsx`). */
export const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 10, lineHeight: 1.4, paddingVertical: 40, paddingHorizontal: 44, color: "#111111" },
  name: { fontSize: 20, fontWeight: 700 },
  contact: { fontSize: 9, marginTop: 4, color: "#333333" },
  paragraph: { marginBottom: 6 },
});

/**
 * CV de coluna única guiado por template: só texto, sem tabela nem imagem. Trechos com `flagged` ficam de fora;
 * seção vazia não aparece. Trechos vazios (só espaços) também ficam de fora, e a experiência repetida não vira
 * um cabeçalho duplicado.
 */
export function CvDocument({ cv: rawCv, templateId }: { cv: AssembledCv; templateId: CvTemplateId }) {
  // NFC uma vez, na entrada: as fontes embutidas não têm marcas combinantes soltas e o ATS compara texto composto.
  const cv = toNfc(rawCv);
  const t = getTemplate(templateId);
  const s = buildStyles(t);
  const clean = cleanCv(cv, t.sections.includes("highlights"));
  const ctx = { cv, clean, t, s };
  const location = t.locationLine ? locationLine(cv) : null;
  const keywords = clean.skills.join(", ");
  return (
    <Document
      title={cv.name ? `CV ${cv.name}` : "CV"}
      author={cv.name || undefined}
      subject={clean.headline || undefined}
      keywords={keywords || undefined}
      creator="Job Find"
      producer="Job Find"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          {cv.name ? <Text style={s.name}>{cv.name}</Text> : null}
          {clean.headline ? <Text style={s.headline}>{clean.headline}</Text> : null}
          {cv.contactLine ? <Text style={s.contact}>{cv.contactLine}</Text> : null}
          {location ? <Text style={s.contact}>{location}</Text> : null}
        </View>
        {t.sections.map((id) => {
          const el = renderSection(id, ctx);
          return el ? <View key={id}>{el}</View> : null;
        })}
      </Page>
    </Document>
  );
}
