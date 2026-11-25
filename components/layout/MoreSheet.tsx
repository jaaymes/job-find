"use client";

import { ChevronRight, CircleHelp as HelpIcon, Database, Heart, KeyRound, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ComponentType, KeyboardEvent, ReactNode } from "react";
import { OnboardingGuide } from "@/components/onboarding/OnboardingGuide";
import { HardLink } from "@/components/ui/hard-link";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useTheme, type ThemePref } from "@/lib/client/theme/ThemeProvider";
import { cn } from "@/lib/utils";

const ROW = "relative flex min-h-[52px] w-full items-center gap-3.5 rounded-[10px] px-2 text-[15px] text-jf-ink no-underline";
const ROW_FOCUS = "outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function Chip({ icon: IconComponent }: { icon: Icon }) {
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-jf-chip text-jf-ink-2">
      <IconComponent className="size-[18px]" />
    </span>
  );
}

function RowBody({ icon, label, hint }: { icon: Icon; label: string; hint?: string }) {
  return (
    <>
      <Chip icon={icon} />
      <span className="flex-1">
        {label}
        {hint && <span className="block text-xs text-jf-ink-3">{hint}</span>}
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-jf-ink-3" />
    </>
  );
}

const THEME_OPTIONS: readonly { value: ThemePref; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

function ThemeRadioGroup() {
  const { pref, setPref } = useTheme();

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = THEME_OPTIONS[(index + step + THEME_OPTIONS.length) % THEME_OPTIONS.length];
    setPref(next.value);
    const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[THEME_OPTIONS.indexOf(next)]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Tema" className="grid w-[220px] grid-cols-3 rounded-[10px] bg-jf-chip p-[3px]">
      {THEME_OPTIONS.map((option, index) => {
        const checked = pref === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPref(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "h-11 cursor-pointer rounded-lg text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-jf-brand",
              checked ? "bg-jf-surface font-semibold text-jf-ink" : "font-medium text-jf-ink-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type LinkRow = { label: string; href: string; icon: Icon; hint?: string };

const ROWS_BEFORE_GUIDE: readonly LinkRow[] = [
  { label: "Configurações de IA", href: "/configuracoes", icon: KeyRound },
  { label: "Dados e backup", href: "/configuracoes", icon: Database, hint: "Exportar ou importar seus dados" },
  { label: "Fontes de vagas", href: "/fontes", icon: Radar },
];

const ROWS_AFTER_GUIDE: readonly LinkRow[] = [
  { label: "Apoie o projeto", href: "/apoie", icon: Heart },
  { label: "Privacidade", href: "/privacidade", icon: ShieldCheck },
];

/** Folha "Mais" da barra de abas: atalhos secundários e seletor de tema. */
export function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = () => onOpenChange(false);

  function renderRow(row: LinkRow): ReactNode {
    const body = <RowBody icon={row.icon} label={row.label} hint={row.hint} />;
    const className = cn(ROW, ROW_FOCUS);
    return (
      <li key={row.label}>
        {row.href === "/configuracoes" ? (
          <HardLink href="/configuracoes" className={className} onClick={close}>
            {body}
          </HardLink>
        ) : (
          <Link href={row.href} className={className} onClick={close}>
            {body}
          </Link>
        )}
      </li>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Mais" className="md:hidden">
        <ul className="m-0 list-none p-0">
          {ROWS_BEFORE_GUIDE.map(renderRow)}
          <li className="relative">
            {/* O botão do guia é o próprio item; o ícone e a seta ficam por cima, sem capturar toques. */}
            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
              <Chip icon={HelpIcon} />
            </span>
            <OnboardingGuide triggerClassName={cn(ROW, ROW_FOCUS, "cursor-pointer pl-[58px] text-left")} />
            <ChevronRight
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-jf-ink-3"
            />
          </li>
          {ROWS_AFTER_GUIDE.map(renderRow)}
        </ul>
        <div className="mt-1.5 flex min-h-[52px] items-center gap-3 border-t border-jf-line pt-2.5">
          <span className="flex-1 text-[15px]">Tema</span>
          <ThemeRadioGroup />
        </div>
      </SheetContent>
    </Sheet>
  );
}
