import { describe, expect, it } from "vitest";
import {
  apply_repost_risk,
  extract_first_url,
  extract_job_fields,
  guess_source,
  is_url,
  job_key,
  risk_level_for,
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
  const base = { source: "indeed" as const };
  const good_link = "https://www.indeed.com/rc/clk/dl?jk=abc";

  it("scores a well-formed posting as low risk", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      title: "Engineer",
      location: "Remote",
      text: "A normal job description.",
      link: good_link,
    });
    expect(out.risk_score).toBe(0);
    expect(out.risk_level).toBe("low");
  });

  it("flags off-platform contact / up-front payment hard", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      text: "Contact us on telegram and we will send a wire transfer.",
      link: good_link,
    });
    expect(out.risk_score).toBe(6); // scam only; company present, link on-platform
    expect(out.risk_level).toBe("high");
    expect(out.notes.some((n) => n.includes("scam"))).toBe(true);
  });

  it("does NOT flag 'signal' in an electronics job description (the old false positive)", () => {
    // This is the exact bug that scored every Indeed digest 6/10.
    const out = score_risk({
      ...base,
      title: "Relay Field Technician",
      company: "Qualus",
      location: "Philadelphia, PA",
      text: "Install and maintain low-voltage signal wiring, relay systems, and fire alarm circuits.",
      link: good_link,
    });
    expect(out.risk_score).toBe(0);
    expect(out.risk_level).toBe("low");
  });

  it("does NOT flag 'urgent care' as pressure language", () => {
    const out = score_risk({
      ...base,
      title: "Radiology Technician",
      company: "Urgent Care Partners",
      text: "Join our urgent care clinic supporting local patients.",
      link: good_link,
    });
    expect(out.risk_score).toBe(0);
  });

  it("penalizes an off-platform application link", () => {
    const out = score_risk({
      ...base,
      company: "Acme Corp",
      text: "normal text",
      link: "https://totally-legit-jobs.xyz/apply",
    });
    expect(out.risk_score).toBe(2);
    expect(out.notes.some((n) => n.includes("off-platform"))).toBe(true);
  });

  it("accepts subdomains of every known job board", () => {
    for (const link of [
      "https://uk.linkedin.com/jobs/view/5",
      "https://cts.indeed.com/v3/xyz",
      "https://www.glassdoor.com/job/1",
      "https://www.ziprecruiter.com/jobs/2",
      "https://jobs.monster.com/3",
    ]) {
      const out = score_risk({ ...base, company: "Acme Corp", text: "normal", link });
      expect(out.risk_score, link).toBe(0);
    }
  });

  it("penalizes a missing company and a missing link", () => {
    const out = score_risk({ ...base, text: "normal text" });
    expect(out.risk_score).toBe(2);
    expect(out.notes).toContain("No company name listed.");
    expect(out.notes).toContain("No application link.");
  });

  it("stacks signals and clamps to 10", () => {
    const out = score_risk({
      ...base,
      // scam (+6) + no company (+1) + off-platform link (+2) + pressure (+1) = 10
      text: "hiring now — pay a processing fee via whatsapp",
      link: "https://scam.example.net/x",
    });
    expect(out.risk_score).toBe(10);
    expect(out.risk_level).toBe("avoid");
  });

  it("flags requests for sensitive personal info", () => {
    const out = score_risk({
      ...base,
      company: "Acme",
      text: "To onboard, email a copy of your driver's license and your bank routing number.",
      link: good_link,
    });
    expect(out.risk_score).toBe(6);
    expect(out.risk_level).toBe("high");
    expect(out.notes.some((n) => n.includes("sensitive personal info"))).toBe(true);
  });

  it("flags a scam interview channel (Google Hangouts)", () => {
    const out = score_risk({
      ...base,
      company: "Acme",
      text: "The interview will be conducted over Google Hangouts.",
      link: good_link,
    });
    expect(out.risk_score).toBe(6);
  });

  it("flags 'get rich' / MLM framing at a moderate level", () => {
    const out = score_risk({
      ...base,
      company: "Acme",
      text: "Be your own boss and earn passive income with this investment opportunity.",
      link: good_link,
    });
    expect(out.risk_score).toBe(3);
    expect(out.risk_level).toBe("maybe");
  });

  it("flags an 'earn $X a day' pay lure", () => {
    const out = score_risk({
      ...base,
      company: "Acme",
      text: "Work from home and earn $500 a day, no experience needed!",
      link: good_link,
    });
    // unrealistic pay (+2) + pressure "no experience needed" (+1) = 3
    expect(out.risk_score).toBe(3);
    expect(out.notes.some((n) => n.includes("improbably high pay"))).toBe(true);
  });

  it("flags a free-webmail application contact", () => {
    const out = score_risk({
      ...base,
      company: "Acme",
      text: "Send your resume to hr.acme.recruiter@gmail.com to apply.",
      link: good_link,
    });
    expect(out.risk_score).toBe(2);
    expect(out.notes.some((n) => n.includes("webmail"))).toBe(true);
  });

  it("does NOT flag a legitimate day-rate pay quote", () => {
    // A plain rate ("$650/day") is not the "earn $X a day" lure framing.
    const out = score_risk({
      ...base,
      title: "Contract Consultant",
      company: "Deloitte",
      pay: "$650/day",
      text: "Six-month contract engagement for a senior consultant.",
      link: good_link,
    });
    expect(out.risk_score).toBe(0);
  });

  it("does NOT flag legitimate mentions of 'social security' benefits or bank roles", () => {
    const out = score_risk({
      ...base,
      title: "Teller",
      company: "First National Bank",
      text: "Process deposits and help clients understand social security benefit direct deposits.",
      link: good_link,
    });
    expect(out.risk_score).toBe(0);
  });
});

describe("risk_level_for", () => {
  it("maps scores to tiers at the documented boundaries", () => {
    expect([0, 1, 2].map(risk_level_for)).toEqual(["low", "low", "low"]);
    expect([3, 4, 5].map(risk_level_for)).toEqual(["maybe", "maybe", "maybe"]);
    expect([6, 7, 8].map(risk_level_for)).toEqual(["high", "high", "high"]);
    expect([9, 10].map(risk_level_for)).toEqual(["avoid", "avoid"]);
  });

  it("clamps out-of-range scores", () => {
    expect(risk_level_for(-5)).toBe("low");
    expect(risk_level_for(99)).toBe("avoid");
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
