CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE OR REPLACE FUNCTION job_search_vector(p_title text, p_company text, p_stacks text[], p_lang text, p_body text)
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('simple', f_unaccent(coalesce(p_title,'')||' '||coalesce(p_company,'')||' '||array_to_string(p_stacks,' '))), 'A')
      || setweight(to_tsvector(CASE p_lang WHEN 'pt' THEN 'portuguese' WHEN 'en' THEN 'english'
                                           WHEN 'es' THEN 'spanish' ELSE 'simple' END::regconfig,
                               f_unaccent(coalesce(p_title,'')||' '||left(coalesce(p_body,''),20000))), 'C')
$$;

CREATE TABLE jobs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key        text NOT NULL,
  url_canonical     text NOT NULL,
  title             text NOT NULL,
  company           text NOT NULL,
  company_logo_url  text,
  summary           text NOT NULL DEFAULT '',
  description_html  text NOT NULL CHECK (octet_length(description_html) <= 30000),
  sanitizer_version smallint NOT NULL,
  country           char(2),
  city              text,
  origin            text NOT NULL DEFAULT 'unknown' CHECK (origin IN ('national','international','unknown')),
  accepts_brazil    boolean,
  work_mode         text NOT NULL DEFAULT 'unknown' CHECK (work_mode IN ('remote','hybrid','onsite','unknown')),
  seniority         text CHECK (seniority IN ('intern','junior','mid','senior','lead')),
  language          text NOT NULL DEFAULT 'unknown',
  stacks            text[] NOT NULL DEFAULT '{}',
  sources           text[] NOT NULL DEFAULT '{}',
  salary_min        numeric(12,2), salary_max numeric(12,2),
  salary_currency   char(3), salary_period text CHECK (salary_period IN ('hour','month','year')),
  published_at      timestamptz NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  content_hash      text NOT NULL,
  expired_at        timestamptz,
  search_vector     tsvector NOT NULL
);
CREATE UNIQUE INDEX jobs_dedupe_active_uq ON jobs (dedupe_key)    WHERE expired_at IS NULL;
CREATE UNIQUE INDEX jobs_url_active_uq    ON jobs (url_canonical) WHERE expired_at IS NULL;
CREATE INDEX jobs_feed_idx      ON jobs (published_at DESC, id DESC)            WHERE expired_at IS NULL;
CREATE INDEX jobs_mode_feed_idx ON jobs (work_mode, published_at DESC, id DESC) WHERE expired_at IS NULL;
CREATE INDEX jobs_stacks_gin    ON jobs USING gin (stacks)        WHERE expired_at IS NULL;
CREATE INDEX jobs_sources_gin   ON jobs USING gin (sources)       WHERE expired_at IS NULL;
CREATE INDEX jobs_fts_gin       ON jobs USING gin (search_vector) WHERE expired_at IS NULL;
CREATE INDEX jobs_expired_idx   ON jobs (expired_at)              WHERE expired_at IS NOT NULL;

CREATE TABLE job_sources (
  source text NOT NULL, external_id text NOT NULL,
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  missed_runs   smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (source, external_id)
) WITH (fillfactor = 85);
CREATE INDEX job_sources_job_idx ON job_sources (job_id);

CREATE TABLE source_state (
  source text PRIMARY KEY,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_success_at timestamptz, last_fetched_count int,
  cursor text,                 -- fontes incrementais (Himalayas, Jobicy, GitHub since)
  locked_until timestamptz
);

CREATE TABLE source_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','ok','error','skipped')),
  fetched_count int, new_count int, updated_count int, expired_count int, error text
);
CREATE INDEX source_runs_src_idx ON source_runs (source, started_at DESC);
