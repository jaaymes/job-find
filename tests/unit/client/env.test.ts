import { expect, it } from "vitest";

it("testes em tests/unit/client rodam em jsdom", () => {
  expect(typeof document).toBe("object");
});
