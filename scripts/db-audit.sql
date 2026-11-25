-- Diagnóstico do banco do Job Find (somente leitura).
--
-- Este arquivo só contém SELECT. Nenhuma consulta altera dados.
-- Rode no editor SQL do Neon:
--   1. antes do deploy da limpeza (linha de base);
--   2. 7 dias depois do deploy.
-- Anote os números na spec: docs/tech/2026-11-25-auditoria-insercao-e-limpeza-de-vagas.md

-- 5.1 Tamanho por tabela (dados + índices + TOAST)
-- Espere: jobs e job_sources menores depois da limpeza; source_runs parado de crescer.
SELECT relname, n_live_tup, n_dead_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;

-- 5.2 Vagas por estado e idade
-- Espere: mais_60d e expirada_30d zerados ou perto de zero depois da primeira execução da limpeza.
SELECT (expired_at IS NULL) AS ativa,
       count(*) AS vagas,
       count(*) FILTER (WHERE published_at < now() - interval '60 days') AS mais_60d,
       count(*) FILTER (WHERE expired_at < now() - interval '30 days') AS expirada_30d,
       pg_size_pretty(sum(pg_column_size(description_html))::bigint) AS descricoes
FROM jobs GROUP BY 1;

-- 5.3 Duplicata provável entre fontes (mesma empresa + título, chaves diferentes)
-- Espere: poucas linhas. Muitas linhas com cidades ou modos diferentes indicam o caso A-04.
SELECT lower(unaccent(company)) AS empresa, lower(unaccent(title)) AS titulo,
       count(*) AS linhas, array_agg(DISTINCT city) AS cidades,
       array_agg(DISTINCT work_mode) AS modos, array_agg(id) AS ids
FROM jobs WHERE expired_at IS NULL
GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY linhas DESC LIMIT 50;

-- 5.4 Integridade: deve voltar tudo zero
-- Espere: as quatro colunas em 0. Qualquer valor diferente de zero é problema a investigar.
SELECT
  (SELECT count(*) FROM (SELECT dedupe_key FROM jobs WHERE expired_at IS NULL GROUP BY 1 HAVING count(*) > 1) d) AS chave_dup,
  (SELECT count(*) FROM (SELECT url_canonical FROM jobs WHERE expired_at IS NULL GROUP BY 1 HAVING count(*) > 1) u) AS url_dup,
  (SELECT count(*) FROM jobs j WHERE expired_at IS NULL AND NOT EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = j.id)) AS ativa_sem_fonte,
  (SELECT count(*) FROM jobs WHERE expired_at IS NULL AND published_at < now() - interval '45 days') AS ativa_vencida;

-- 5.5 Log de coletas
-- Espere: linhas limitadas a cerca de 30 dias depois da limpeza; presas em 0.
SELECT count(*) AS linhas, min(started_at) AS mais_antiga,
       count(*) FILTER (WHERE status = 'running' AND started_at < now() - interval '1 hour') AS presas
FROM source_runs;

-- 9.1a Últimas coletas do LinkedIn: espere fetched_count > 0 a cada 2 h depois da mudança
-- Espere: uma linha a cada 2 h com fetched_count > 0. Status 'error' ou 'running' antigo pedem olhar o campo error.
SELECT started_at, status, fetched_count, new_count, updated_count, error
FROM source_runs WHERE source = 'linkedin' ORDER BY started_at DESC LIMIT 30;

-- 9.1b Vagas do LinkedIn por dia de entrada
-- Espere: contagem diária estável e acima de zero. Queda para zero indica que a coleta parou de inserir.
SELECT date_trunc('day', s.first_seen_at) AS dia, count(*)
FROM job_sources s WHERE s.source = 'linkedin' GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
