import { describe, expect, it } from "vitest";
import { safeUrl } from "@/lib/shared/url";

describe("safeUrl", () => {
  it("rejeita esquemas perigosos e http por padrão", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("http://a.com/x")).toBeNull();
  });

  it("aceita http apenas com allowHttp", () => {
    expect(safeUrl("http://a.com/x", { allowHttp: true })).toBe("http://a.com/x");
  });

  it("rejeita URLs com mais de 2048 caracteres", () => {
    expect(safeUrl("https://a.com/" + "x".repeat(2048))).toBeNull();
  });

  it("apara espaços e normaliza o host em minúsculas", () => {
    expect(safeUrl("  https://A.com/vaga  ")).toBe("https://a.com/vaga");
  });

  it("rejeita URLs com credenciais (usuário ou senha)", () => {
    expect(safeUrl("https://user:senha@a.com/vaga")).toBeNull();
    expect(safeUrl("https://user@a.com/vaga")).toBeNull();
  });

  it("rejeita entrada que não é URL", () => {
    expect(safeUrl("não é uma url")).toBeNull();
  });
});
