import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extract_glassdoor_job_cards } from "../src/helpers.js";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/glassdoor-jobalert.html", import.meta.url)),
  "utf-8",
);

describe("extract_glassdoor_job_cards", () => {
  const cards = extract_glassdoor_job_cards(fixture);

  it("finds every job card in the digest", () => {
    expect(cards).toHaveLength(6);
  });

  it("extracts title, company, and location for every card", () => {
    for (const c of cards) {
      expect(c.title, `title for ${JSON.stringify(c)}`).toBeTruthy();
      expect(c.company, `company for ${c.title}`).toBeTruthy();
      expect(c.location, `location for ${c.title}`).toBeTruthy();
    }
  });

  it("parses a card with pay correctly", () => {
    const c = cards.find((c) => c.company === "Maestro Technologies");
    expect(c).toBeDefined();
    expect(c?.title).toBe("Information Technology Specialist - II");
    expect(c?.location).toBe("Belvidere, NJ");
    expect(c?.pay).toMatch(/US\$24/);
    expect(c?.link).toContain("glassdoor");
  });

  it("parses a card without an avatar", () => {
    const c = cards.find((c) => c.company === "Westchester Technology Group");
    expect(c).toBeDefined();
    expect(c?.title).toContain("Jr Systems Administrator");
    expect(c?.location).toBe("Elmsford, NY");
    expect(c?.pay).toMatch(/US\$30/);
  });

  it("extracts links for all cards", () => {
    for (const c of cards) {
      expect(c.link, `link for ${c.title}`).toContain("glassdoor");
    }
  });
});
