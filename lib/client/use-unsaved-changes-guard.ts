"use client";

import { useEffect } from "react";

/** Remove a barra final (exceto na raiz) para `/perfil` e `/perfil/` valerem como a mesma tela. */
const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") || "/" : path);

/**
 * Avisa antes de sair da página com alterações não salvas: `beforeunload` para fechar/recarregar
 * e um `confirm` para cliques em links internos (os links do app fazem navegação completa).
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;

    // Depois de aceitar o `confirm`, a navegação completa dispara `beforeunload`: não pergunta de novo.
    let leaving = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearLeaving = () => {
      leaving = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving) return;
      e.preventDefault();
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const a = target.closest("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      let url: URL;
      try {
        url = new URL(a.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || trimSlash(url.pathname) === trimSlash(window.location.pathname)) return;
      if (window.confirm(message)) {
        clearLeaving();
        leaving = true;
        timer = setTimeout(clearLeaving, 1000);
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", clearLeaving);
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", clearLeaving);
      clearLeaving();
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [dirty, message]);
}
