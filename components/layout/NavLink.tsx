import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
import { HardLink } from "@/components/ui/hard-link";
import { cn } from "@/lib/utils";
import { isLocalRoute } from "./nav";

const ITEM = "inline-flex min-h-11 items-center rounded-lg px-3.5 py-2.5 text-[15px] md:min-h-0";

/** Classes do item do menu (compartilhadas com o link "Vagas", que preserva a última busca). */
export function navLinkClassName(current?: boolean, className?: string): string {
  return cn(
    ITEM,
    "no-underline outline-none focus-visible:ring-2 focus-visible:ring-jf-brand",
    current ? "bg-jf-brand-soft font-semibold text-jf-brand-dark" : "text-jf-ink-2 hover:bg-jf-chip",
    className,
  );
}

/**
 * Link do menu. Rotas `(local)` usam `HardLink` (navegação completa, para aplicar a CSP de nonce); as demais,
 * `next/link` (navegação do cliente).
 */
export function NavLink({
  href,
  current,
  className,
  ...rest
}: { href: string; current?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const props = {
    ...rest,
    "aria-current": current ? ("page" as const) : undefined,
    className: navLinkClassName(current, className),
  };
  return isLocalRoute(href) ? <HardLink href={href} {...props} /> : <Link href={href} {...props} />;
}
