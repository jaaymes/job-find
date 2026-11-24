"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { stripUrlQuery } from "@/lib/shared/analytics";

// Wrapper client: o `beforeSend` é uma função e não pode ser passado do layout (Server Component).
// O script vem de /_vercel/insights (mesma origem), então a CSP atual já cobre: 'self' nas rotas
// públicas e 'strict-dynamic' nas (local), onde ele é injetado pelo bundle que já tem o nonce.
function beforeSend(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: stripUrlQuery(event.url) };
}

export function VercelAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
