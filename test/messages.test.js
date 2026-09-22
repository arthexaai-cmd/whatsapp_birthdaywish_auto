import { describe, it, expect } from "vitest";
import { renderMessage } from "../src/core/messages.js";

const messagesConfig = {
  onTime: ["Happy birthday {name}! {wish}"],
  belated: ["Belated happy birthday {name}! {wish}"],
  vars: { wish: ["Have a great day."] },
  emoji: ["🎂"],
};

function person(overrides) {
  return {
    name: "Priya Sharma",
    firstName: "Priya",
    phoneE164: "+919812345678",
    birthMonth: 3,
    birthDay: 14,
    birthYear: 1995,
    customMessage: null,
    salutation: null,
    rowNum: 2,
    ...overrides,
  };
}

describe("renderMessage", () => {
  it("renders an on-time message with name and expanded vars", () => {
    const text = renderMessage(person({}), false, messagesConfig, () => 0);
    expect(text).toContain("Priya");
    expect(text).toContain("Have a great day.");
    expect(text).not.toContain("{");
  });

  it("renders a belated message from the belated pool", () => {
    const text = renderMessage(person({}), true, messagesConfig, () => 0);
    expect(text).toMatch(/Belated/);
  });

  it("uses salutation over first name when present", () => {
    const text = renderMessage(person({ salutation: "Dr. Sharma" }), false, messagesConfig, () => 0);
    expect(text).toContain("Dr. Sharma");
  });

  it("uses a custom message verbatim, substituting only {name}", () => {
    const p = person({ customMessage: "Yo {name}, happy bday!!" });
    const text = renderMessage(p, false, messagesConfig, () => 0);
    expect(text).toBe("Yo Priya, happy bday!!");
  });

  it("appends an emoji when rng favors it, omits when not", () => {
    const withEmoji = renderMessage(person({}), false, messagesConfig, () => 0.1);
    const withoutEmoji = renderMessage(person({}), false, messagesConfig, () => 0.9);
    expect(withEmoji.endsWith("🎂")).toBe(true);
    expect(withoutEmoji.endsWith("🎂")).toBe(false);
  });
});
