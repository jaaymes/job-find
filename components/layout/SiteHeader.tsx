import Link from "next/link";
import { NavLink } from "./NavLink";
import { PRIMARY_NAV, type NavId } from "./nav";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader({ current }: { current?: NavId }) {
  return (
    <header className="border-b border-jf-line bg-jf-surface">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-jf-ink no-underline">
          {/* Símbolo da marca (lupa cujo cabo forma o J); mesmo desenho de public/brand/jobfind-mark.svg. */}
          <svg aria-hidden="true" viewBox="7 3 43 59" className="h-8 w-auto" fill="none" strokeWidth={6}>
            <circle cx="28" cy="24" r="16" className="stroke-jf-ink" />
            <path
              d="M39.5 35.5L45 41V48a9 9 0 0 1-18 0"
              className="stroke-jf-ink"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="28" cy="24" r="5" className="fill-jf-brand" />
          </svg>
          <span className="font-display text-[19px] font-bold">
            Job <span className="text-jf-brand">Find</span>
          </span>
        </Link>
        <nav
          aria-label="Principal"
          className="-mx-1 flex basis-full flex-wrap gap-1 max-sm:order-last sm:mx-0 sm:flex-1 sm:basis-auto"
        >
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.id} href={item.href} current={item.id === current}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* Do sm em diante fica à direita do nav (a mesma ordem do foco). No celular o nav desce para a
            linha de baixo (max-sm:order-last) e o botão fica na linha do logo, encostado à direita. */}
        {/* Apoie sai do menu principal e fica como link discreto à direita (spec D-06/P-05). */}
        <NavLink href="/apoie" current={current === "apoie"} className="ml-auto text-sm sm:ml-0">
          Apoie
        </NavLink>
        <ThemeToggle />
      </div>
    </header>
  );
}
