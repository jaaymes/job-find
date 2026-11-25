import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { HardLink } from "@/components/ui/hard-link";

export const metadata: Metadata = { title: "Job Find — Privacidade" };

const LINK = "text-jf-brand underline underline-offset-2 hover:text-jf-brand-dark";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

// Conteúdo estático (D-01): sem acesso a banco nem a dados do usuário.
export default function PrivacidadePage() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className="mx-auto flex w-full max-w-[800px] flex-1 flex-col gap-7 px-4 pt-6 pb-16 text-[15px] leading-relaxed text-jf-ink-2 sm:px-6 sm:pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[28px] leading-tight font-bold text-jf-ink">Privacidade</h1>
          <p>
            O Job Find não tem login nem cadastro. Esta página explica, sem rodeios, o que fica no seu navegador, o que
            passa pelo servidor e o que você controla.
          </p>
        </div>

        <Section title="Onde ficam os seus dados">
          <p>
            Seu currículo, perfil, vagas salvas, candidaturas e configurações ficam apenas no armazenamento local do seu
            navegador (localStorage). O servidor guarda somente o índice público de vagas, coletado de fontes abertas, e
            nunca recebe o seu currículo nem o seu perfil.
          </p>
          <p>
            O arquivo de backup que você pode exportar em <HardLink href="/configuracoes" className={LINK}>Configurações</HardLink>{" "}
            contém dados pessoais (currículo, perfil e histórico). Guarde-o com cuidado e evite compartilhá-lo.
          </p>
        </Section>

        <Section title="Envio ao provedor de IA que você escolher">
          <p>
            Quando você usa as funções de IA, o navegador envia o texto necessário diretamente ao provedor que você
            escolheu, com a sua própria chave de API. Nada passa pelo servidor do Job Find. Antes da primeira chamada,
            você vê um aviso. O tratamento desses dados passa a seguir a política de privacidade do provedor escolhido.
          </p>
        </Section>

        <Section title="Transferência internacional de dados">
          <p>
            Ao escolher um provedor, é você quem transfere os dados a ele, e alguns ficam fora do Brasil: o OpenRouter
            opera nos Estados Unidos e a DeepSeek opera na China. No plano gratuito do Gemini, o Google pode usar o que
            você enviar para treinar seus modelos. Nos modelos gratuitos do OpenRouter (o padrão do Job Find quando você conecta
            o OpenRouter), quem oferece o modelo pode guardar o texto, usá-lo para treino ou publicá-lo; você vê e aceita
            esse aviso antes de conectar. Se isso importa para você, prefira um plano pago ou outro provedor, e
            evite enviar dados que não queira compartilhar.
          </p>
        </Section>

        <Section title="Logs de IP da Vercel">
          <p>
            O site é hospedado na Vercel, que registra o endereço IP e dados técnicos das requisições em logs de
            infraestrutura, por motivos de segurança e operação. O Job Find não grava logs com dados pessoais por conta
            própria.
          </p>
        </Section>

        <Section title="Analytics">
          <p>
            O Job Find usa o Vercel Web Analytics para contar visitas de forma agregada (quantas pessoas abriram cada
            página, de que país e com que tipo de navegador). Ele não usa cookies e não identifica você entre sites.
            Antes do envio, o endereço da página é cortado no caminho: filtros e termos de busca não entram nessa
            medição. Seu currículo, perfil e chaves de API nunca fazem parte dessa medição.
          </p>
        </Section>

        <Section title="Como apagar tudo">
          <p>
            Como os seus dados ficam só no seu navegador, você os apaga limpando os dados deste site nas configurações do
            navegador (cookies e dados de sites). Isso remove perfil, vagas salvas, chaves e configurações. Não há conta
            para excluir, e backups que você exportou continuam nos seus arquivos até você apagá-los.
          </p>
        </Section>

        <Section title="Remoção de dados de terceiros em vagas">
          <p>
            As vagas vêm de fontes públicas e podem citar nomes ou contatos de pessoas, como recrutadores. Se você é uma
            dessas pessoas e quer que o dado seja removido, escreva para{" "}
            <strong className="font-semibold text-jf-ink">[EMAIL DE CONTATO]</strong> informando o link da vaga.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
