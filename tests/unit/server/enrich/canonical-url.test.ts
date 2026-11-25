import { describe, expect, it } from "vitest";
import { canonicalUrl } from "@/lib/server/enrich/canonical-url";

describe("canonicalUrl", () => {
  it.each([
    ["https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x", "https://boards.greenhouse.io/acme/jobs/123"],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/1", "https://boards.eu.greenhouse.io/acme/jobs/1"],
    ["https://jobs.lever.co/acme/abc-123/apply", "https://jobs.lever.co/acme/abc-123"],
    ["https://jobs.ashbyhq.com/acme/0f1e/application", "https://jobs.ashbyhq.com/acme/0f1e"],
    ["https://WWW.Example.com/Jobs/ABC/", "https://example.com/Jobs/ABC"],
    ["https://example.com/", "https://example.com/"],
    ["https://example.com/j?b=2&a=1&utm_source=x#top", "https://example.com/j?a=1&b=2"],
    ["https://example.com/j?q=a%20b", "https://example.com/j?q=a%20b"],
    ["https://example.com/j?b=2&a=1", "https://example.com/j?a=1&b=2"],
    ["https://example.com/j?q=a%20b&utm_source=x", "https://example.com/j?q=a%20b"],
    ["https://example.com/j?q=a%20b&a=x%2By", "https://example.com/j?a=x%2By&q=a%20b"],
    ["https://example.com/j?utm_source=x", "https://example.com/j"],
    ["https://example.com/jobs/1/apply", "https://example.com/jobs/1/apply"],
    ["https://jobs.smartrecruiters.com/AcmeBR/7440-Dev", "https://jobs.smartrecruiters.com/AcmeBR/7440-Dev"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalUrl(raw)).toBe(expected);
  });

  it("URL insegura vira null", () => {
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
  });
});
