"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "./SiteHeader";
import { navItemForPath } from "./nav";

/** Cabeçalho das rotas (local): destaca o item do menu conforme o caminho (o layout não recebe a rota). */
export function LocalHeader() {
  return <SiteHeader current={navItemForPath(usePathname())} />;
}
