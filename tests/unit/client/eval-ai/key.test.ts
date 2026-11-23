import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { assertOutsideRepoOrIgnored, readHiddenLine, readKeyFile } from "@/scripts/eval-ai/key";

describe("readHiddenLine", () => {
  it("lê a 1ª linha do stdin redirecionado e não escreve a chave na saída", async () => {
    const input = new PassThrough();
    const written: string[] = [];
    const p = readHiddenLine("Chave: ", input, { write: (s) => written.push(s) });
    input.write("sk-segredo-123\nresto\n");
    expect(await p).toBe("sk-segredo-123");
    expect(written.join("")).not.toContain("segredo");
    expect(written[0]).toBe("Chave: ");
  });
  it("sem quebra de linha, aceita o fim do stream", async () => {
    const input = new PassThrough();
    const p = readHiddenLine("", input, { write: () => {} });
    input.end("abc");
    expect(await p).toBe("abc");
  });
});

describe("readKeyFile", () => {
  const setup = async (content: string) => {
    const dir = await mkdtemp(join(tmpdir(), "key-"));
    const file = join(dir, "k.txt");
    await writeFile(file, content);
    return { dir, file };
  };
  it("lê a chave de um arquivo fora do repositório", async () => {
    const { file } = await setup("  sk-abc\n");
    expect(await readKeyFile(file, { repoRoot: "/repo/inexistente" })).toBe("sk-abc");
  });
  it("recusa arquivo dentro do repositório que o git não ignora, e aceita se ignorado", async () => {
    const { dir, file } = await setup("sk-abc");
    await expect(readKeyFile(file, { repoRoot: dir, isIgnored: () => false })).rejects.toThrow(/repositório/);
    expect(await readKeyFile(file, { repoRoot: dir, isIgnored: () => true })).toBe("sk-abc");
  });
  it("recusa arquivo vazio ou com mais de uma palavra, sem repetir o conteúdo", async () => {
    const empty = await setup("\n");
    await expect(readKeyFile(empty.file, { repoRoot: "/x" })).rejects.toThrow(/só a chave/);
    const multi = await setup("sk-segredo outra-coisa");
    const err = await readKeyFile(multi.file, { repoRoot: "/x" }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("segredo");
  });
  it("arquivo inexistente: erro sem o caminho do conteúdo", async () => {
    await expect(readKeyFile("/nao/existe/k", { repoRoot: "/x" })).rejects.toThrow("não foi possível ler");
  });
});

describe("assertOutsideRepoOrIgnored (--out)", () => {
  it("recusa diretório dentro do repositório não ignorado; aceita fora ou ignorado", () => {
    expect(() => assertOutsideRepoOrIgnored("/repo/x/out", { repoRoot: "/repo/x", isIgnored: () => false }, "o diretório do --out")).toThrow(
      /o diretório do --out está dentro do repositório/,
    );
    expect(assertOutsideRepoOrIgnored("/repo/x/out", { repoRoot: "/repo/x", isIgnored: () => true }, "d")).toBe("/repo/x/out");
    expect(assertOutsideRepoOrIgnored("/fora/out", { repoRoot: "/repo/x", isIgnored: () => false }, "d")).toBe("/fora/out");
  });
});
