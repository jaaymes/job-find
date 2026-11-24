import { expect, it } from "vitest";

it("testes fora de client rodam em node", () => {
  expect(typeof document).toBe("undefined");
});
