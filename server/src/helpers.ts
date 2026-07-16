export function html_unescape(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&middot;/g, "\u00b7")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export function strip_html_tags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extract_linkedin_job_cards(
  html: string,
): Array<{ title?: string; company_location?: string; pay?: string; link?: string }> {
  const out: Array<{ title?: string; company_location?: string; pay?: string; link?: string }> = [];

  const card_chunks = html.split(/data-test-id="job-card"/i).slice(1);

  for (const chunk of card_chunks) {
    const title_match = chunk.match(
      /class="[^"]*font-bold[^"]*text-system-blue-50[^"]*"[^>]*>\s*([^<]{2,120}?)\s*<\/a>/i,
    );
    const title = title_match ? html_unescape(title_match[1].trim()) : undefined;

    const company_loc_match = chunk.match(
      /<p[^>]*class="[^"]*text-system-gray-100[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/i,
    );
    const company_location = company_loc_match
      ? html_unescape(strip_html_tags(company_loc_match[1]))
      : undefined;

    const pay_match = chunk.match(
      /<p[^>]*class="[^"]*text-system-gray-70[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/i,
    );
    const pay = pay_match ? html_unescape(strip_html_tags(pay_match[1])) : undefined;

    const link_match = chunk.match(
      /https:\/\/www\.linkedin\.com\/comm\/jobs\/view\/\d+\/[^"'<\s)]+/i,
    );
    const link = link_match ? html_unescape(link_match[0]) : undefined;

    if (title || (link && link.includes("/jobs/view/"))) {
      out.push({ title, company_location, pay, link });
    }
  }

  return out;
}

export function extract_indeed_job_cards(
  html: string,
): Array<{ title?: string; company?: string; location?: string; pay?: string; link?: string }> {
  const out: Array<{
    title?: string;
    company?: string;
    location?: string;
    pay?: string;
    link?: string;
  }> = [];

  // Each job is introduced by its title link, tagged "strong-text-link". This
  // covers both the multi-job digest (www.indeed.com/rc/clk, pagead/clk) and the
  // single-job "match" email (cts.indeed.com). We split on those anchors and read
  // the fields that follow.
  const anchor_re =
    /<a\s+href="(https:\/\/[a-z.]*indeed\.com\/[^"]*)"[^>]*class="strong-text-link"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors = [...html.matchAll(anchor_re)];

  for (let i = 0; i < anchors.length; i++) {
    const m = anchors[i];
    const link = html_unescape(m[1]);
    const title = html_unescape(strip_html_tags(m[2])) || undefined;

    // The card body runs from this title anchor to the start of the next one.
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < anchors.length ? (anchors[i + 1].index ?? html.length) : html.length;
    const body = html.slice(start, end);

    // Fields appear as a fixed sequence of <p> elements:
    //   company, [rating], location, [salary], ["Easily apply"], description, age
    let company: string | undefined;
    let location: string | undefined;
    let pay: string | undefined;
    let seen_company = false;

    for (const pm of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = html_unescape(strip_html_tags(pm[1]));
      if (!text) continue;
      // The "posted N days ago" line marks the end of this card's fields.
      if (
        /^(just posted|today|yesterday|posted\b.*\bago|\d+\+?\s*(day|hour|minute|week|month)s?\s+ago)$/i.test(
          text,
        )
      ) {
        break;
      }
      // In single-job "match" emails, a personalized profile/footer section
      // (with the user's own name and desired pay) follows the job — stop there.
      if (
        /^(do you want to get more jobs|keep your indeed profile|recent work experience)/i.test(
          text,
        )
      ) {
        break;
      }
      if (/^\d(\.\d)?$/.test(text)) continue; // employer rating (e.g. "3.4")
      if (text.toLowerCase() === "easily apply") continue;
      if (!pay && text.length <= 40 && /^\$[\d,]/.test(text)) {
        pay = text;
        continue;
      }
      if (!seen_company) {
        if (text.length <= 80) {
          company = text;
          seen_company = true;
        }
        continue;
      }
      if (!location && text.length <= 60) location = text;
    }

    if (title || link) {
      out.push({ title, company, location, pay, link });
    }
  }

  return out;
}
