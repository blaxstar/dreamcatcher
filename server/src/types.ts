export type job_source = "linkedin" | "indeed" | "unknown";
export type risk_level = "low" | "maybe" | "high" | "avoid";
export type job_status = "pending" | "applied" | "skipped";

export type job_item = {
  source: job_source;
  email_id: string;
  thread_id?: string;
  received_iso?: string;

  title?: string;
  company?: string;
  location?: string;
  link?: string;
  pay?: string;

  risk_score: number;
  risk_level: risk_level;
  notes: string[];
};

export type user_settings = {
  gmail_query: string;
  max_messages: number;
  max_apply_today: number;
  theme: "dark" | "light";
};

export type db_user = {
  email: string;
  display_name: string | null;
  picture_url: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expiry: number | null;
  settings_json: string;
  created_at: number;
  updated_at: number;
};

export type db_job = {
  id: number;
  user_email: string;
  job_key: string;
  source: job_source;
  title: string | null;
  company: string | null;
  location: string | null;
  link: string | null;
  pay: string | null;
  risk_score: number;
  risk_level: risk_level;
  status: job_status;
  notes_json: string;
  email_id: string | null;
  times_seen: number;
  first_seen: number;
  updated_at: number;
};

export const DEFAULT_SETTINGS: user_settings = {
  gmail_query: "newer_than:7d (from:(jobalerts-noreply@linkedin.com) OR from:(alert@indeed.com))",
  max_messages: 40,
  max_apply_today: 3,
  theme: "dark",
};
