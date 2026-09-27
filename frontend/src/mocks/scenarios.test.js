import { describe, it, expect } from "vitest";
import { demoAnswer, seedSources } from "./scenarios";
describe("demo consultation boundaries", () => {
  it("never presents an unsupported query as verified", () => {
    const a = demoAnswer("Tell me the winning lottery numbers", "india", "en");
    expect(a.status).toBe("abstained");
    expect(a.citations).toEqual([]);
  });
  it("keeps source evidence within the requested scope", () => {
    for (const scope of ["india", "international", "us", "eu", "uk"]) {
      const a = demoAnswer("Can I patent this herbal product? ", scope, "en");
      expect(a.citations.every((s) => s.scope === scope)).toBe(true);
      expect(
        a.citations.every((s) => seedSources.some((x) => x.id === s.id)),
      ).toBe(true);
    }
  });
  it("asks only the next classification question, then abstains instead of guessing", () => {
    const a = demoAnswer("Help classify my product", "india", "en");
    expect(a.context.pending).toBe("intended_use");
    const b = demoAnswer("Medicine", "india", "en", a.context);
    expect(b.context.pending).toBe("classical_basis");
    const c = demoAnswer("I changed the preparation", "india", "en", b.context);
    expect(c.status).toBe("abstained");
    expect(c.context.intended_use).toBe("Medicine");
  });
  it("preserves official locators in Hindi", () => {
    const a = demoAnswer("क्या पेटेंट हो सकता है?", "india", "hi");
    expect(a.language).toBe("hi");
    expect(a.citations[0].locator).toBe("Section 3(p)");
  });
});
