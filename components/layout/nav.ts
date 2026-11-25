import type { LocalRoute } from "@/components/ui/hard-link";

export type NavId = "vagas" | "minhas-vagas" | "perfil" | "configuracoes" | "apoie" | "fontes" | "privacidade";

/** Itens do menu principal (header do desktop; o celular tem a barra de abas própria). */
export const PRIMARY_NAV: readonly { id: NavId; label: string; href: string }[] = [
  { id: "vagas", label: "Vagas", href: "/" },
  { id: "minhas-vagas", label: "Minhas vagas", href: "/minhas-vagas" },
  { id: "perfil", label: "Perfil", href: "/perfil" },
  { id: "configuracoes", label: "Configurações", href: "/configuracoes" },
  { id: "fontes", label: "Fontes", href: "/fontes" },
];

/** Itens da folha "Mais". */
export const MORE_NAV: readonly { id: NavId; label: string; href: string; hint?: string }[] = [
  { id: "configuracoes", label: "Configurações", href: "/configuracoes" },
  { id: "fontes", label: "Fontes", href: "/fontes" },
  { id: "apoie", label: "Apoie", href: "/apoie" },
  { id: "privacidade", label: "Privacidade", href: "/privacidade" },
];

const LOCAL_PREFIXES = ["/perfil", "/configuracoes", "/minhas-vagas", "/gerador/"] as const;

/** Rotas `(local)` exigem navegação completa (`HardLink`); as demais usam `next/link`. */
export function isLocalRoute(href: string): href is LocalRoute {
  return LOCAL_PREFIXES.some((prefix) => (prefix.endsWith("/") ? href.startsWith(prefix) : href === prefix));
}

const PATH_ITEMS: readonly [string, NavId][] = [
  ["/minhas-vagas", "minhas-vagas"],
  ["/perfil", "perfil"],
  ["/configuracoes", "configuracoes"],
  ["/apoie", "apoie"],
  ["/fontes", "fontes"],
  ["/privacidade", "privacidade"],
];

/** Item do menu que corresponde ao caminho (por prefixo); `undefined` quando nenhum. */
export function navItemForPath(pathname: string): NavId | undefined {
  return PATH_ITEMS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
}
