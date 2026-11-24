import Link from "next/link";
import { HardLink } from "@/components/ui/hard-link";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

// Minhas vagas, Perfil e Configurações são rotas `(local)`: navegação completa (HardLink) para aplicarem a CSP de nonce.
const NAV = [
  { id: "vagas", label: "Vagas", href: "/" },
  { id: "minhas-vagas", label: "Minhas vagas", href: "/minhas-vagas" },
  { id: "perfil", label: "Perfil", href: "/perfil" },
  { id: "configuracoes", label: "Configurações", href: "/configuracoes" },
  { id: "apoie", label: "Apoie", href: "/apoie" },
] as const;

type NavItem = (typeof NAV)[number];

const ITEM = "rounded-lg px-3.5 py-2.5 text-[15px]";

function NavLink({ href, current, children }: { href: NavItem["href"]; current: boolean; children: string }) {
  const props = {
    "aria-current": current ? ("page" as const) : undefined,
    className: cn(
      ITEM,
      "no-underline outline-none focus-visible:ring-2 focus-visible:ring-jf-brand",
      current ? "bg-jf-brand-soft font-semibold text-jf-brand-dark" : "text-jf-ink-2 hover:bg-jf-chip",
    ),
  };
  // Rotas públicas e estáticas: navegação do cliente, sem recarregar a página.
  return href === "/" || href === "/apoie" ? (
    <Link href={href} {...props}>
      {children}
    </Link>
  ) : (
    <HardLink href={href} {...props}>
      {children}
    </HardLink>
  );
}

export function SiteHeader({ current }: { current?: NavItem["id"] }) {
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
          {NAV.map((item) => (
            <NavLink key={item.id} href={item.href} current={item.id === current}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* Do sm em diante fica à direita do nav (a mesma ordem do foco). No celular o nav desce para a
            linha de baixo (max-sm:order-last) e o botão fica na linha do logo, encostado à direita. */}
        <ThemeToggle className="ml-auto sm:ml-0" />
      </div>
    </header>
  );
}
