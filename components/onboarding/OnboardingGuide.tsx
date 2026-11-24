"use client";

import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HardLink, type LocalRoute } from "@/components/ui/hard-link";
import { hasUsableProvider } from "@/lib/client/ai/model";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { onboardingStore } from "@/lib/client/onboarding/store";
import { profileStore } from "@/lib/client/profile/store";
import { probeStorage, useStore } from "@/lib/client/storage/store";

type Seen = "ssr" | "unseen" | "seen";

const seenSnapshot = (): Seen => (onboardingStore.get() === null ? "unseen" : "seen");

type Step = {
  title: string;
  body: ReactNode;
  cta?: { href: LocalRoute; label: string };
  done?: boolean;
};

const CTA =
  "inline-flex min-h-11 w-fit items-center rounded-lg bg-jf-brand px-4 text-sm font-semibold text-jf-surface no-underline outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2";

/**
 * Guia de primeira visita: explica a privacidade (tudo fica no localStorage) e leva a pessoa a conectar
 * uma IA gratuita e importar o currículo. Abre sozinho uma única vez; o botão do rodapé reabre.
 */
export function OnboardingGuide({ triggerClassName }: { triggerClassName?: string }) {
  const pathname = usePathname();
  const seen = useSyncExternalStore<Seen>(onboardingStore.subscribe, seenSnapshot, () => "ssr");
  const settings = useStore(aiSettingsStore);
  const profile = useStore(profileStore);
  const [manualOpen, setManualOpen] = useState(false);
  // Fechado nesta página mesmo se o localStorage recusar a gravação (senão o diálogo não fecharia).
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState(0);

  // Callback do OAuth do OpenRouter: a tela só troca o código pela chave, sem interrupções.
  const onCallback = pathname.startsWith("/configuracoes/callback");
  const autoOpen = seen === "unseen" && !closed && !onCallback && probeStorage() === "ok";
  const open = manualOpen || autoOpen;

  const aiReady = settings !== null && hasUsableProvider(settings, "analyze");
  const cvReady = profile !== null;

  function finish() {
    setClosed(true);
    setManualOpen(false);
    onboardingStore.set({ seenAt: new Date().toISOString() });
  }

  const steps: Step[] = [
    {
      title: "Bem-vindo ao Job Find",
      body: (
        <>
          <p>
            O Job Find é gratuito e open-source. Em três passos você usa 100% da plataforma sem pagar nada:
            busca de vagas, chance de contratação em cada vaga, análise com IA e currículo sob medida.
          </p>
          <p className="rounded-lg border border-jf-line bg-jf-surface-2 p-3 text-jf-ink-2">
            <strong className="text-jf-ink">Seus dados ficam só com você.</strong> Perfil, currículo, chaves de
            IA, vagas salvas e documentos gerados são gravados no armazenamento local (localStorage) deste
            navegador. Nada disso é gravado no nosso servidor: os pedidos à IA vão direto do seu navegador ao
            provedor que você escolher. Para trocar de navegador, use o backup em Configurações.
          </p>
        </>
      ),
    },
    {
      title: "1. Conecte uma IA (grátis)",
      body: (
        <>
          <p>
            A IA lê seu currículo, analisa as vagas e escreve CVs. Recomendado: entre com o{" "}
            <strong className="text-jf-ink">OpenRouter</strong>, que usa modelos gratuitos por padrão. O Google
            Gemini (plano gratuito) e a IA local no seu computador também funcionam.
          </p>
          <p className="text-jf-ink-3">A chave é sua e fica guardada apenas neste navegador.</p>
        </>
      ),
      cta: { href: "/configuracoes", label: "Conectar IA" },
      done: aiReady,
    },
    {
      title: "2. Importe seu currículo",
      body: (
        <>
          <p>
            <strong className="text-jf-ink">Recomendado: o PDF do seu LinkedIn.</strong> No seu perfil do
            LinkedIn, clique em &ldquo;Mais&rdquo; e depois em &ldquo;Salvar em PDF&rdquo;. Em seguida, importe o
            arquivo na página Perfil. Também aceitamos outro currículo em PDF ou DOCX, ou o texto colado.
          </p>
          <p className="text-jf-ink-3">
            Com IA e currículo prontos, cada vaga mostra sua chance e você gera um CV sob medida em um clique.
          </p>
        </>
      ),
      cta: { href: "/perfil", label: "Importar currículo" },
      done: cvReady,
    },
  ];

  const current = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          setStep(0);
          setManualOpen(true);
        }}
      >
        Guia de início
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && finish()}>
        <DialogContent className="gap-4 sm:max-w-md">
          <DialogHeader>
            <p className="text-xs font-medium text-jf-ink-3" aria-live="polite">
              Passo {step + 1} de {steps.length}
            </p>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
              {current.title}
              {current.done && (
                <span className="rounded-full bg-jf-brand-soft px-2 py-0.5 text-xs font-medium text-jf-brand">
                  Concluído
                </span>
              )}
            </DialogTitle>
            <DialogDescription render={<div />} className="flex flex-col gap-3 text-sm text-jf-ink-2">
              {current.body}
            </DialogDescription>
          </DialogHeader>
          {current.cta && !current.done && (
            <HardLink href={current.cta.href} className={CTA} onClick={finish}>
              {current.cta.label}
            </HardLink>
          )}
          <div className="flex justify-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-jf-brand" : "w-1.5 bg-jf-line-strong"}`}
              />
            ))}
          </div>
          <DialogFooter>
            {step === 0 ? (
              <Button variant="ghost" className="min-h-11" onClick={finish}>
                Pular guia
              </Button>
            ) : (
              <Button variant="outline" className="min-h-11" onClick={() => setStep((s) => s - 1)}>
                Voltar
              </Button>
            )}
            <Button className="min-h-11" onClick={() => (last ? finish() : setStep((s) => s + 1))}>
              {last ? "Concluir" : "Próximo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
