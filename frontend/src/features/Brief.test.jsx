import { expect, test } from "vitest";
import { buildBrief } from "./Brief";

test("brief contains only explicitly selected facts and messages", () => {
  const privateMessage = {
    id: "private",
    scope: "india",
    role: "user",
    content: "Unselected confidential question",
  };
  const chosen = {
    id: "chosen",
    scope: "us",
    role: "user",
    content: "Selected question",
  };
  const consultation = {
    title: "Research",
    facts: { secret: "Secret formula" },
    messages: [privateMessage, chosen],
  };
  const result = buildBrief(
    consultation,
    { product: "Selected product" },
    [chosen],
    true,
  );
  expect(result).toContain("DEMO FIXTURES");
  expect(result).toContain("[us] Question");
  expect(result).not.toContain("confidential");
  expect(result).not.toContain("Secret formula");
});
