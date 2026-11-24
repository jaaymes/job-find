import { cimdOrigin } from "@/lib/server/cimd";

/** Client ID Metadata Document (CIMD): o client_id do OAuth é a URL deste próprio documento. */
export function GET(req: Request): Response {
  const origin = cimdOrigin(req);
  if (!origin) {
    return Response.json({ error: "origem inválida" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    {
      client_id: `${origin}/.well-known/oauth-cimd`,
      client_name: "Job Find",
      redirect_uris: [`${origin}/configuracoes/callback`],
      token_endpoint_auth_method: "none",
      client_uri: origin,
      logo_uri: `${origin}/icon.svg`,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
