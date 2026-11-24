import "client-only";

export type CvLang = "pt" | "en" | "es";

const MONTHS: Record<CvLang, readonly string[]> = {
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
};
const CURRENT: Record<CvLang, string> = { pt: "atual", en: "Present", es: "actualidad" };

/** `AAAA-MM` vira "mês AAAA" no idioma; `AAAA` fica como está; qualquer outra coisa volta sem alteração. */
function formatDate(raw: string, lang: CvLang): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw.trim());
  return m ? `${MONTHS[lang][Number(m[2]) - 1]} ${m[1]}` : raw.trim();
}

/** Período de uma experiência no idioma do CV: "jan 2021 – atual", "Jan 2021 – Present", "ene 2021 – actualidad". */
export function formatPeriod(start: string | null, end: string | null, lang: CvLang): string {
  if (!start && !end) return "";
  if (!start) return formatDate(end as string, lang);
  return `${formatDate(start, lang)} – ${end ? formatDate(end, lang) : CURRENT[lang]}`;
}
