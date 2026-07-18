// The app must never be able to search a user's whole mailbox — only specific
// senders. A safe query is built entirely from `newer_than:` and `from:` clauses
// (optionally joined by OR / parentheses). Anything else (subject:, has:, label:,
// in:, bare keywords, negation) means the query could reach beyond job alerts, so
// we reject it. This turns "we only read job alerts" from a promise into a rule
// the server enforces.
export function is_safe_job_query(query: string): boolean {
  if (typeof query !== "string") return false;
  const q = query.trim();
  if (q === "" || q.length > 2000) return false;
  // A query must actually constrain the sender.
  if (!/from:/i.test(q)) return false;
  // Strip every allowed piece; if anything is left over, it isn't safe.
  const leftover = q
    .replace(/newer_than:\d+[dmy]/gi, " ")
    .replace(/from:\([^)]*\)/gi, " ")
    .replace(/from:[^\s()]+/gi, " ")
    .replace(/\bOR\b/gi, " ")
    .replace(/[()]/g, " ")
    .trim();
  return leftover === "";
}
