import { describe, expect, it } from "vitest";
import { parseRssItems } from "@/lib/server/sources/rss";

describe("parseRssItems (RSS compartilhado)", () => {
  it("lê os campos conhecidos de cada <item>, com CDATA e entidades", () => {
    const xml = `<rss><channel><title>x</title>
      <item><title><![CDATA[Acme: Dev]]></title><link>https://a.test/1</link><guid>g1</guid><pubDate>Fri, 20 Nov 2026 08:00:00 +0200</pubDate></item>
      <item><title>Beta &amp; Co: Ops</title><link>https://a.test/2</link></item>
    </channel></rss>`;
    expect(parseRssItems(xml)).toEqual([
      { title: "Acme: Dev", link: "https://a.test/1", guid: "g1", pubDate: "Fri, 20 Nov 2026 08:00:00 +0200" },
      { title: "Beta & Co: Ops", link: "https://a.test/2" },
    ]);
  });

  it("devolve [] quando não há itens (ex.: HTML no lugar do feed)", () => {
    expect(parseRssItems("<html></html>")).toEqual([]);
  });
});
