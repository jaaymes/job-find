"use client";

import { PROVIDERS } from "@/lib/client/ai/providers";

/** Guia da IA local (Ollama / LM Studio): CORS, endereço de loopback e permissão de rede local do Chrome. */
export function LocalAiGuide() {
  const origin = window.location.origin;
  return (
    <section
      aria-labelledby="local-guide-title"
      className="flex flex-col gap-2 rounded-lg border border-jf-line bg-jf-bg p-3 text-[13px] text-jf-ink-2"
    >
      <h4 id="local-guide-title" className="text-sm font-semibold text-jf-ink">
        Guia da IA local
      </h4>
      <p>
        Recurso experimental: depende do navegador e da configuração do seu computador, e pode deixar de funcionar
        sem aviso.
      </p>
      <ol className="ml-4 list-decimal space-y-1.5">
        <li>
          Use o endereço <code>127.0.0.1</code> (padrão: <code>{PROVIDERS.local.baseURL}</code>), e não o nome do
          computador.
        </li>
        <li>
          <strong>Ollama:</strong> libere esta página antes de iniciar o servidor, com{" "}
          <code className="break-all">OLLAMA_ORIGINS={origin}</code>.
        </li>
        <li>
          <strong>LM Studio:</strong> ative o servidor local com a opção de CORS (<code>--cors</code> na linha de
          comando).
        </li>
        <li>
          No Chrome, aceite a permissão de acesso à rede local quando o navegador perguntar, depois de clicar em
          &ldquo;Testar conexão&rdquo;.
        </li>
      </ol>
      <a
        href={PROVIDERS.local.keyDocsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-fit text-jf-brand underline"
      >
        Documentação do Ollama (abre em nova aba)
      </a>
    </section>
  );
}
