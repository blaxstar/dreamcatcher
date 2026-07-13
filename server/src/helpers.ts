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

  const card_chunks = html.split(/class="r-d"/i).slice(1);

  for (const chunk of card_chunks) {
    const title_match = chunk.match(/<a[^>]*>\s*([^<]{2,160}?)\s*<\/a>/i);
    const title = title_match ? html_unescape(strip_html_tags(title_match[1])) : undefined;

    const company_match = chunk.match(/class="r-g"[^>]*>\s*([^<]{2,160}?)\s*<\/span>/i);
    const company = company_match ? html_unescape(strip_html_tags(company_match[1])) : undefined;

    const location_match = chunk.match(/class="r-h"[^>]*>\s*([^<]{2,160}?)\s*<\/span>/i);
    let location = location_match ? html_unescape(strip_html_tags(location_match[1])) : undefined;
    if (location) location = location.replace(/^\s*-\s*/, "").trim();

    const pay_match = chunk.match(/>\s*(\$[0-9][^<]{0,80})\s*<\/td>/i);
    const pay = pay_match ? html_unescape(strip_html_tags(pay_match[1])) : undefined;

    const link_match = chunk.match(/https?:\/\/(?:engage\.)?indeed\.com\/[^"'<\s)]+/i);
    const link = link_match ? html_unescape(link_match[0]) : undefined;

    if (title || (link && link.includes("indeed.com"))) {
      out.push({ title, company, location, pay, link });
    }
  }

  return out;
}
