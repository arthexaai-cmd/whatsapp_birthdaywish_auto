import { describe, it, expect } from "vitest";
import { cardName } from "../src/core/messages.js";

const person = (o = {}) => ({ name: "Abhijit Sharma", firstName: "Abhijit", salutation: "", ...o });

describe("cardName", () => {
  it("defaults to the full name plus the postfix, exactly as stored", () => {
    expect(cardName(person(), undefined, "ji")).toBe("Abhijit Sharma ji");
    expect(cardName(person({ name: "PRIYA sharma", firstName: "PRIYA" }), {}, "")).toBe("PRIYA sharma");
  });
  it("puts the salutation in front", () => {
    expect(cardName(person({ salutation: "Mr" }), {}, "ji")).toBe("Mr Abhijit Sharma ji");
  });
  it("can drop the salutation, the postfix, or use the first name", () => {
    const p = person({ salutation: "Dr" });
    expect(cardName(p, { includeSalutation: false }, "ji")).toBe("Abhijit Sharma ji");
    expect(cardName(p, { includePostfix: false }, "ji")).toBe("Dr Abhijit Sharma");
    expect(cardName(p, { nameParts: "first" }, "ji")).toBe("Dr Abhijit ji");
  });
  it("does not double a salutation that already contains the name", () => {
    expect(cardName(person({ name: "Sharma", firstName: "Sharma", salutation: "Dr. Sharma" }), {}, "")).toBe("Dr. Sharma");
  });
  it("returns an empty string when there is no name", () => {
    expect(cardName({ name: "", firstName: "" }, {}, "ji")).toBe("");
  });
});
