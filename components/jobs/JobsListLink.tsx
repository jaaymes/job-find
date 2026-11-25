"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useJobsListHref } from "@/lib/client/jobs/list-href";

/** Link para a lista de vagas que preserva a última busca (RF-11). */
export function JobsListLink(props: Omit<ComponentProps<typeof Link>, "href">) {
  const href = useJobsListHref();
  return <Link {...props} href={href} />;
}
