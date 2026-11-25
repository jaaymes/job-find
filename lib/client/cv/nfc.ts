/** Normaliza para NFC todas as strings de um valor (objetos, arrays e strings aninhados). */
export function toNfc<T>(value: T): T {
  if (typeof value === "string") return value.normalize("NFC") as T;
  if (Array.isArray(value)) return value.map(toNfc) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toNfc(v)])) as T;
  }
  return value;
}
