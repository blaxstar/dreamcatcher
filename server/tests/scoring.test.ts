import { describe, expect, it } from "vitest";
import {
  apply_repost_risk,
  extract_first_url,
  extract_job_fields,
  guess_source,
  is_url,
  job_key,
  score_risk,
} from "../src/scoring.js";

const DAY = 1000 * 60 * 60 * 24;

describe("is_url", () => {
  it("accepts http and https only", () => {
    expect(is_url("https://linkedin.com/jobs/view/1")).toBe(true);
    expect(is_url("http://indeed.com")).toBe(true);
    expect(is_url("ftp://files.example.com")).toBe(false);
    expect(is_url("javascript:alert(1)")).toBe(false);
    expect(is_url("not a url")).toBe(false);
    expect(is_url(undefined)).toBe(false);
  });
});

describe("extract_first_url", () => {
  it("pulls the first url out of a body", () => {
    const body = "See the role here: https://www.linkedin.com/jobs/view/123 and apply soon.";
    expect(extract_first_url(body)).toBe("https://www.linkedin.com/jobs/view/123");
  });

  it("strips trailing punctuation that is not part of the url", () => {
    expect(extract_first_url("Apply at https://indeed.com/job/42.")).toBe(
      "https://indeed.com/job/42",
    );
    expect(extract_first_url("(https://indeed.com/job/42)")).toBe("https://indeed.com/job/42");
  });

  it("returns undefined when there is no url", () => {
    expect(extract_first_url("no links in this email at all")).toBeUndefined();
  });
});

describe("guess_source", () => {
  it("identifies the sender from the from header or subject", () => {
    expect(guess_source("jobalerts-noreply@linkedin.com", "Job alert")).toBe("linkedin");
    expect(guess_source("alert@indeed.com", "New jobs")).toBe("indeed");
    expect(guess_source("someone@example.com", "Your LinkedIn job alert")).toBe("linkedin");
    expect(guess_source("someone@example.com", "hello")).toBe("unknown");
    expect(guess_source(undefined, undefined)).toBe("unknown");
  });
});

describe("extract_job_fields", () => {
  it("parses a linkedin-style 'job alert: <title> at <company>' subject", () => {
    const out = extract_job_fields(
      "Job alert: Senior Frontend Engineer at Acme Corp",
      "Location: Remote (US)\nApply: https://www.linkedin.com/jobs/view/999",
    );
    expect(out.title).toBe("Senior Frontend Engineer");
    expect(out.company).toBe("Acme Corp");
    expect(out.location).toBe("Remote (US)");
    expect(out.link).toBe("https://www.linkedin.com/jobs/view/999");
    expect(out.notes).toEqual([]);
  });

  it("strips a trailing '| LinkedIn' from the company", () => {
    const out = extract_job_fields(
      "Job alert: Designer at Globex | LinkedIn",
      "https://www.linkedin.com/jobs/view/1",
    );
    expect(out.company).toBe("Globex");
  });

  it("notes when no link could be found", () => {
    const out = extract_job_fields("Job alert: Dev at Acme", "This email is HTML-only.");
    expect(out.link).toBeUndefined();
    expect(out.notes).toContain("No link found (email format may be HTML-only).");
  });
});

describe("job_key", () => {
  it("is stable across casing and whitespace differences", () => {
    const a = job_key({ title: "Senior  Dev", company: "Acme", location: "Remote" });
    const b = job_key({ title: "senior dev", company: "ACME", location: " remote " });
    expect(a).toBe(b);
  });

  it("distinguishes different jobs", () => {
    const a = job_key({ title: "Dev", company: "Acme", location: "Remote" });
    const b = job_key({ title: "Dev", company: "Globex", location: "Remote" });
    expect(a).not.toBe(b);
  });
});

describe("score_risk", () => {
  const base = { source: "linkedin" as const, body_text: "", subject: "", from: "" };

  it("scores a well-formed linkedin posting as low risk", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      title: "Engineer",
      body_text: "A normal job description.",
      link: "https://www.linkedin.com/jobs/view/123",
    });
    expect(out.risk_score).toBe(0);
    expect(out.risk_level).toBe("low");
  });

  it("flags scam payment/communication channels hard", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      body_text: "Contact us on telegram and we will send a wire transfer.",
      link: "https://www.linkedin.com/jobs/view/123",
    });
    expect(out.risk_score).toBeGreaterThanOrEqual(6);
    expect(out.risk_level).toBe("high");
    expect(out.notes).toContain("Contains scam communication/payment keywords.");
  });

  it("penalizes links on non-standard domains", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      body_text: "normal text",
      link: "https://totally-legit-jobs.xyz/apply",
    });
    expect(out.risk_score).toBe(2);
    expect(out.notes.some((n) => n.includes("not a standard LinkedIn/Indeed domain"))).toBe(true);
  });

  it("accepts subdomains of known job hosts", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      body_text: "normal text",
      link: "https://uk.linkedin.com/jobs/view/5",
    });
    expect(out.risk_score).toBe(0);
  });

  it("penalizes a missing company and a missing link", () => {
    const out = score_risk({ ...base, body_text: "normal text" });
    expect(out.risk_score).toBe(2);
    expect(out.notes).toContain("Missing company name.");
  });

  it("clamps the score to a maximum of 10", () => {
    const out = score_risk({
      ...base,
      body_text: "urgent hiring now, pay via crypto gift card on whatsapp, wire transfer",
      link: "https://scam.example.net/x",
    });
    expect(out.risk_score).toBeLessThanOrEqual(10);
    expect(out.risk_level).toBe("avoid");
  });
});

describe("apply_repost_risk", () => {
  const now = Date.now();

  it("leaves a fresh, rarely-seen job untouched", () => {
    const out = apply_repost_risk(1, [], 1, now - 2 * DAY, now);
    expect(out.risk_score).toBe(1);
    expect(out.risk_level).toBe("low");
    expect(out.notes).toEqual([]);
  });

  it("penalizes a job reposted 3+ times over 2+ weeks", () => {
    const out = apply_repost_risk(1, [], 3, now - 15 * DAY, now);
    expect(out.risk_score).toBe(3);
    expect(out.notes.some((n) => n.includes("Reposted 3x"))).toBe(true);
  });

  it("penalizes a listing lingering 4+ weeks", () => {
    const out = apply_repost_risk(1, [], 1, now - 30 * DAY, now);
    expect(out.risk_score).toBe(2);
    expect(out.notes.some((n) => n.includes("Stale listing"))).toBe(true);
  });

  it("stacks both penalties for a stale, frequently reposted job", () => {
    const out = apply_repost_risk(2, ["Missing company name."], 5, now - 30 * DAY, now);
    // 2 base + 2 (reposted) + 1 (stale) = 5
    expect(out.risk_score).toBe(5);
    expect(out.risk_level).toBe("maybe");
    expect(out.notes[0]).toBe("Missing company name.");
    expect(out.notes).toHaveLength(3);
  });

  it("clamps the escalated score to 10", () => {
    const out = apply_repost_risk(9, [], 9, now - 60 * DAY, now);
    expect(out.risk_score).toBe(10);
    expect(out.risk_level).toBe("avoid");
  });

  it("preserves the base notes without mutating them", () => {
    const base_notes = ["original"];
    apply_repost_risk(1, base_notes, 5, now - 30 * DAY, now);
    expect(base_notes).toEqual(["original"]);
  });
});
