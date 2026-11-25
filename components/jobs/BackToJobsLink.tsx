"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { consumeListReturn } from "@/lib/client/jobs/list-href";
import { JobsListLink } from "./JobsListLink";

/**
 * "Voltar" do detalhe: se a vaga foi aberta pela lista nesta aba, volta pelo histórico (preserva rolagem e páginas
 * carregadas); senão, segue o link para a lista com a última busca (RF-12).
 */
export function BackToJobsLink({
  jobId,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  jobId: number;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (consumeListReturn(jobId)) {
      e.preventDefault();
      router.back();
    }
  };
  return (
    <JobsListLink className={className} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </JobsListLink>
  );
}
