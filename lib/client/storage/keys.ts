import "client-only";

/** Chaves do localStorage (D-09). O prefixo `jobfind:v1:` identifica os dados do app. */
export type StorageKey =
  | "jobfind:v1:ai"
  | "jobfind:v1:profile"
  | "jobfind:v1:jobState"
  | "jobfind:v1:aiAnalysis"
  | "jobfind:v1:generatedDocs"
  | "jobfind:v1:savedFilters"
  | "jobfind:v1:lastVisit"
  | "jobfind:v1:lastFilters"
  | "jobfind:v1:onboarding"
  | "jobfind:v1:cvPrefs";

export const STORAGE_PREFIX = "jobfind:";
