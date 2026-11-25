import Link from "next/link";
import { OnboardingGuide } from "@/components/onboarding/OnboardingGuide";

const LINK = "inline-flex min-h-11 items-center text-jf-brand underline-offset-2 hover:text-jf-brand-dark hover:underline";

export function SiteFooter() {
  return (
    <footer className="hidden border-t border-jf-line bg-jf-surface md:block">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap gap-x-6 gap-y-2 px-4 py-5 text-[13px] text-jf-ink-3 sm:px-6">
        <span>Projeto open-source para quem procura emprego em tecnologia.</span>
        <OnboardingGuide triggerClassName={`${LINK} cursor-pointer`} />
        <Link href="/privacidade" className={LINK}>
          Privacidade
        </Link>
        <Link href="/apoie" className={LINK}>
          Apoie o projeto
        </Link>
        <a
          href="https://github.com/jaaymes/job-find"
          className={LINK}
          rel="noopener noreferrer"
        >
          Código no GitHub
        </a>
      </div>
    </footer>
  );
}
