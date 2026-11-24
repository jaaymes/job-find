/**
 * Tira query string e fragmento da URL antes de enviar ao Vercel Web Analytics: os filtros de busca
 * (`/vagas?q=...`) podem carregar texto digitado pelo usuário, e a página de privacidade promete
 * medição agregada sem dados pessoais. Fica só origem + caminho.
 */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
