import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve, isAbsolute } from "node:path";

type KeyInput = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };

/**
 * Lê uma linha sem eco (a chave nunca aparece no terminal). Em TTY usa modo raw; com stdin redirecionado lê a 1ª linha.
 * O prompt vai para o `out` (stderr), e o valor lido nunca é escrito em lugar nenhum.
 */
export function readHiddenLine(
  prompt: string,
  input: KeyInput = process.stdin,
  out: { write: (s: string) => unknown } = process.stderr,
): Promise<string> {
  out.write(prompt);
  return new Promise((resolveLine, reject) => {
    let buf = "";
    const tty = input.isTTY === true && typeof input.setRawMode === "function";
    const done = (err?: Error) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      if (tty) input.setRawMode?.(false);
      input.pause();
      out.write("\n");
      if (err) reject(err);
      else resolveLine(buf.trim());
    };
    const onEnd = () => done();
    const onData = (chunk: Buffer | string) => {
      const s = chunk.toString("utf8");
      if (!tty) {
        const nl = s.indexOf("\n");
        buf += nl === -1 ? s : s.slice(0, nl);
        if (nl !== -1) done();
        return;
      }
      for (const ch of s) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
        if (ch === "\u0003") return done(new Error("interrompido pelo usuário"));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else if (ch >= " ") buf += ch;
      }
    };
    if (tty) input.setRawMode?.(true);
    input.on("data", onData);
    input.on("end", onEnd);
    input.resume();
  });
}

function insideDir(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** `git check-ignore`: 0 = ignorado. Fora de um repositório (ou sem git) conta como não ignorado. */
function gitIgnored(path: string, cwd: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Recusa um caminho dentro do repositório que o git não ignora (evita commitar a chave ou textos gerados).
 * Vale para o `--key-file` e para o diretório do `--out`.
 */
export function assertOutsideRepoOrIgnored(
  path: string,
  opts: { repoRoot: string; isIgnored?: (absPath: string) => boolean },
  what: string,
): string {
  const abs = resolve(path);
  const isIgnored = opts.isIgnored ?? ((p: string) => gitIgnored(p, opts.repoRoot));
  if (insideDir(opts.repoRoot, abs) && !isIgnored(abs)) {
    throw new Error(`${what} está dentro do repositório e não é ignorado pelo git; mova-o para fora ou ignore-o`);
  }
  return abs;
}

/** Lê a chave de um arquivo. Recusa arquivo dentro do repositório que o git não ignora (evita commitar a chave). */
export async function readKeyFile(
  path: string,
  opts: { repoRoot: string; isIgnored?: (absPath: string) => boolean } = { repoRoot: process.cwd() },
): Promise<string> {
  const abs = assertOutsideRepoOrIgnored(path, opts, "o arquivo da chave");
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    throw new Error("não foi possível ler o arquivo da chave");
  }
  const key = raw.trim();
  if (!key || /\s/.test(key)) throw new Error("o arquivo da chave deve conter só a chave, em uma linha");
  return key;
}
