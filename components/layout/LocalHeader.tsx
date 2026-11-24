"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "./SiteHeader";

/** Cabeçalho das rotas (local): destaca o item do menu conforme o caminho (o layout não recebe a rota). */
export function LocalHeader() {
  const pathname = usePathname();
  const current = pathname.startsWith("/configuracoes")
    ? "configuracoes"
    : pathname.startsWith("/perfil")
      ? "perfil"
      : pathname.startsWith("/minhas-vagas")
        ? "minhas-vagas"
        : undefined;
  return <SiteHeader current={current} />;
}
