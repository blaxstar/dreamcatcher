import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extract_indeed_job_cards } from "../src/helpers.js";

// Real (sanitized) Indeed emails. Tracking tokens and personal profile data are
// scrubbed; the markup structure the parser depends on is untouched.
const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/indeed-jobalert.html", import.meta.url)),
  "utf-8",
);
const match_fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/indeed-match.html", import.meta.url)),
  "utf-8",
);

describe("extract_indeed_job_cards (jobalert.indeed.com format)", () => {
  const cards = extract_indeed_job_cards(fixture);

  it("finds every job card in the digest", () => {
    expect(cards).toHaveLength(19);
  });

  it("extracts title, company, and location for every card", () => {
    for (const c of cards) {
      expect(c.title, `title for ${JSON.stringify(c)}`).toBeTruthy();
      expect(c.company, `company for ${c.title}`).toBeTruthy();
      expect(c.location, `location for ${c.title}`).toBeTruthy();
    }
  });

  it("parses a card with rating and hourly pay correctly", () => {
    const c = cards[0];
    expect(c.title).toBe("Data Center Operations Technician");
    expect(c.company).toBe("Amazon Web Services"); // rating "3.4" is skipped, not read as company
    expect(c.location).toBe("Wink, TX");
    expect(c.pay).toBe("$38.30 an hour");
    expect(c.link).toContain("jk=fb22d7f3550da2d7");
  });

  it("parses a card that has no employer rating", () => {
    const c = cards.find((x) => x.company === "American Lazer");
    expect(c?.title).toBe("IT Technician 2");
    expect(c?.location).toBe("Salisbury, MA");
    expect(c?.pay).toBe("$75,000 - $85,000 a year");
  });

  it("handles a card with no listed salary", () => {
    const c = cards.find((x) => x.company === "Vontas");
    expect(c?.title).toBe("Field Service Technician - Travel");
    expect(c?.location).toBe("Remote");
    expect(c?.pay).toBeUndefined();
  });

  it("includes the sponsored (pagead) listing", () => {
    const c = cards.find((x) => x.title === "Senior Service Desk Technician");
    expect(c).toBeTruthy();
    expect(c?.company).toBe("Next7 IT");
    expect(c?.link).toContain("pagead/clk");
  });

  it("never captures a job description as the location", () => {
    // Descriptions are long sentences; locations are short "City, ST" strings.
    for (const c of cards) {
      expect(c.location!.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("extract_indeed_job_cards (match.indeed.com format)", () => {
  const cards = extract_indeed_job_cards(match_fixture);

  it("extracts the single matched job", () => {
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.title).toBe("IT Support Engineer");
    expect(c.company).toBe("Financial Technology Partners");
    expect(c.location).toBe("New York, NY");
    expect(c.pay).toBe("$115,000 a year");
    expect(c.link).toContain("cts.indeed.com");
  });

  it("does not bleed the user's profile pay into the job's pay", () => {
    // The email's profile section lists a desired "minimum base pay" below the
    // job. Parsing must stop before it so the job's salary stays correct.
    expect(cards[0].pay).not.toContain("100,000");
  });
});
