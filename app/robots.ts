import type { MetadataRoute } from "next";

/** A API é para o próprio site: robôs não devem rastreá-la (nem repassar as vagas das fontes, D-07). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" } };
}
