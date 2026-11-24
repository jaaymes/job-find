export function SiteFooter() {
  return (
    <footer className="border-t border-jf-line bg-jf-surface">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap gap-x-6 gap-y-2 px-4 py-5 text-[13px] text-jf-ink-3 sm:px-6">
        <span>Projeto open-source para quem procura emprego em tecnologia.</span>
        <a
          href="https://github.com/jaaymes/job-find"
          className="text-jf-brand underline-offset-2 hover:text-jf-brand-dark hover:underline"
          rel="noopener noreferrer"
        >
          Código no GitHub
        </a>
      </div>
    </footer>
  );
}
