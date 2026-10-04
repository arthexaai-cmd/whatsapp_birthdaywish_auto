import { describe, it, expect } from "vitest";
import { renderMessage, namePostfixFrom } from "../src/core/messages.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

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

  it("puts a title salutation in front of the first name", () => {
    const text = renderMessage(person({ salutation: "Mr" }), false, messagesConfig, () => 0);
    expect(text).toContain("Mr Priya");
  });

  it("uses a salutation that already contains the first name as is", () => {
    const text = renderMessage(person({ salutation: "Dr. Priya" }), false, messagesConfig, () => 0);
    expect(text).toContain("Dr. Priya");
    expect(text).not.toContain("Priya Priya");
  });

  it("appends the postfix after a bare first name", () => {
    const text = renderMessage(person({}), false, messagesConfig, () => 0.9, "ji");
    expect(text).toBe("Happy birthday Priya ji! Have a great day.");
  });

  it("adds no postfix when it is empty", () => {
    const text = renderMessage(person({}), false, messagesConfig, () => 0.9, "");
    expect(text).toBe("Happy birthday Priya! Have a great day.");
  });

  it("appends the postfix after a salutation + first name too", () => {
    const text = renderMessage(person({ salutation: "Mr" }), false, messagesConfig, () => 0.9, "ji");
    expect(text).toContain("Mr Priya ji!");
  });

  it("appends the postfix after a salutation that already contains the first name", () => {
    const text = renderMessage(person({ salutation: "Dr. Priya" }), false, messagesConfig, () => 0.9, "ji");
    expect(text).toContain("Dr. Priya ji!");
  });

  it("applies the postfix to {name} in a custom message", () => {
    const p = person({ customMessage: "Yo {name}, happy bday!!" });
    expect(renderMessage(p, false, messagesConfig, () => 0, "ji")).toBe("Yo Priya ji, happy bday!!");
  });

  it("namePostfixFrom honours the toggle and defaults", () => {
    expect(namePostfixFrom({ namePostfixEnabled: true, namePostfix: " ji " })).toBe("ji");
    expect(namePostfixFrom({ namePostfixEnabled: false, namePostfix: "ji" })).toBe("");
    expect(namePostfixFrom({ namePostfixEnabled: true, namePostfix: "" })).toBe("");
    expect(namePostfixFrom(DEFAULT_SETTINGS)).toBe("ji");
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
