import { describe, expect, it } from "vitest";
import { is_safe_job_query } from "../src/query.js";

describe("is_safe_job_query", () => {
  it("accepts sender-only queries", () => {
    expect(is_safe_job_query("newer_than:7d (from:(a@indeed.com) OR from:(b@linkedin.com))")).toBe(
      true,
    );
    expect(is_safe_job_query("from:(alert@indeed.com)")).toBe(true);
    expect(is_safe_job_query("newer_than:30d from:jobs@x.com")).toBe(true);
  });

  it("rejects anything that could reach beyond specific senders", () => {
    expect(is_safe_job_query("newer_than:7d")).toBe(false); // no sender constraint
    expect(is_safe_job_query("subject:invoice from:(a@b.com)")).toBe(false);
    expect(is_safe_job_query("has:attachment from:(a@b.com)")).toBe(false);
    expect(is_safe_job_query("in:anywhere from:(a@b.com)")).toBe(false);
    expect(is_safe_job_query("from:(a@b.com) password")).toBe(false); // bare keyword
    expect(is_safe_job_query("label:important")).toBe(false);
    expect(is_safe_job_query("")).toBe(false);
    expect(is_safe_job_query("   ")).toBe(false);
  });
});
