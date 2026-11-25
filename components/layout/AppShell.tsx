import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LocalHeader } from "./LocalHeader";
import { MobileTabBar } from "./MobileTabBar";
import type { NavId } from "./nav";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Estrutura comum das páginas: cabeçalho, `<main id="conteudo">`, rodapé e barra de abas do celular.
 * Sem `current`, o destaque do menu vem do caminho (rotas `(local)`, cujo layout não recebe a rota).
 * Com `tabBar={false}`, a página monta a própria barra de ação (vaga, gerador).
 */
export function AppShell({
  current,
  tabBar = true,
  className,
  children,
}: {
  current?: NavId;
  tabBar?: boolean;
  /** Ajustes do elemento principal (largura, tipografia). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      {current ? <SiteHeader current={current} /> : <LocalHeader />}
      <main id="conteudo"
        className={cn(
          "mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pt-6 sm:px-6 sm:pt-7",
          tabBar ? "pb-tabbar" : "pb-16",
          className,
        )}
      >
        {children}
      </main>
      <SiteFooter />
      {tabBar && <MobileTabBar current={current} />}
    </>
  );
}
