import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/ui/styles";

describe("buttonVariants", () => {
  it("BTN_PRIMARY e Button variant primary geram as mesmas classes", () => {
    expect(BTN_PRIMARY).toBe(buttonVariants({ variant: "primary" }));
    expect(BTN_OUTLINE).toBe(buttonVariants({ variant: "outline" }));
  });

  it("primary usa text-jf-on-brand e ring jf-brand", () => {
    const classes = buttonVariants({ variant: "primary" }).split(" ");
    expect(classes).toContain("text-jf-on-brand");
    expect(classes).toContain("focus-visible:ring-jf-brand");
  });

  it("md tem alvo de 44px no celular e 36px no desktop", () => {
    const classes = buttonVariants({ size: "md" }).split(" ");
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("md:min-h-9");
  });
});
