"use client";

import { Bookmark, Search, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { HardLink } from "@/components/ui/hard-link";
import { useJobsListHref } from "@/lib/client/jobs/list-href";
import { isSavedStage, useJobStates } from "@/lib/client/jobs/job-state";
import { cn } from "@/lib/utils";
import { HIDE_ON_TEXT_FOCUS } from "./hide-on-text-focus";
import { MoreSheet } from "./MoreSheet";
import { isLocalRoute, MORE_NAV, navItemForPath, type NavId } from "./nav";

const TAB = "flex flex-col items-center justify-center gap-[3px] text-[11px] leading-none font-semibold outline-none";
const PILL = "grid h-[30px] w-14 place-items-center rounded-full";
const FOCUS = "focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-inset";

const TABS: readonly { id: NavId; label: string; href: string; icon: LucideIcon }[] = [
  { id: "vagas", label: "Vagas", href: "/", icon: Search },
  { id: "minhas-vagas", label: "Minhas vagas", href: "/minhas-vagas", icon: Bookmark },
  { id: "perfil", label: "Perfil", href: "/perfil", icon: User },
];

const MORE_IDS = new Set<NavId>(MORE_NAV.map((item) => item.id));

function currentFromPath(pathname: string): NavId | undefined {
  if (pathname === "/" || pathname.startsWith("/vagas/")) return "vagas";
  return navItemForPath(pathname);
}

/** Vagas da etapa "Salvas" de Minhas vagas (mesmo critério da coluna). */
function useSavedCount(): number {
  const states = useJobStates();
  if (!states) return 0;
  return Object.values(states).filter(isSavedStage).length;
}

/** Barra de abas inferior do celular (abaixo de `md`). Se `current` faltar, deduz do caminho. */
export function MobileTabBar({ current }: { current?: NavId }) {
  const pathname = usePathname();
  const active = current ?? currentFromPath(pathname);
  const saved = useSavedCount();
  const listHref = useJobsListHref();
  const [moreOpen, setMoreOpen] = useState(false);
  // Ao cruzar md (girar o celular) a folha some; fecha o estado junto (mesmo padrão dos filtros).
  const md = useMediaQuery("(min-width: 768px)");
  if (md && moreOpen) setMoreOpen(false);
  const moreActive = active !== undefined && MORE_IDS.has(active);

  return (
    <>
      <nav
        aria-label="Navegação inferior"
        className={cn("fixed inset-x-0 bottom-0 z-40 grid h-[calc(64px+env(safe-area-inset-bottom))] grid-cols-4 border-t border-jf-line bg-jf-surface pb-[env(safe-area-inset-bottom)] md:hidden", HIDE_ON_TEXT_FOCUS)}
      >
        {TABS.map(({ id, label, href, icon: Icon }) => {
          const isActive = id === active;
          const Comp = isLocalRoute(href) ? HardLink : Link;
          return (
            <Comp
              key={id}
              href={(id === "vagas" ? listHref : href) as never}
              aria-current={isActive ? "page" : undefined}
              aria-label={id === "minhas-vagas" && saved > 0 ? `${label}, ${saved} salvas` : undefined}
              className={cn(TAB, FOCUS, "no-underline", isActive ? "text-jf-brand" : "text-jf-ink-3")}
            >
              <span className={cn(PILL, "relative", isActive && "bg-jf-brand-soft")}>
                <Icon aria-hidden="true" className="size-[22px]" />
                {id === "minhas-vagas" && saved > 0 && (
                  <span aria-hidden="true" className="absolute top-0 right-1 grid min-w-[18px] place-items-center rounded-full bg-jf-brand px-1 py-0.5 text-[10px] leading-none font-bold text-jf-on-brand">
                    {saved}
                  </span>
                )}
              </span>
              {label}
            </Comp>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={cn(TAB, FOCUS, "cursor-pointer", moreActive ? "text-jf-brand" : "text-jf-ink-3")}
        >
          <span className={cn(PILL, moreActive && "bg-jf-brand-soft")}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </span>
          Mais
        </button>
      </nav>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
