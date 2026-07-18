import { api } from "./api.js";

export type User = {
  email: string;
  display_name: string | null;
  picture_url: string | null;
};

let current_user: User | null = null;

export async function check_auth(): Promise<User | null> {
  try {
    current_user = await api<User>("GET", "/auth/me");
    return current_user;
  } catch {
    current_user = null;
    return null;
  }
}

export function get_user(): User | null {
  return current_user;
}

export async function logout(): Promise<void> {
  await api("POST", "/auth/logout");
  current_user = null;
  // Force a fresh Gmail sync on the next sign-in.
  sessionStorage.removeItem("dreamcatcher:synced");
  window.location.reload();
}

export type AccountInfo = {
  email: string;
  display_name: string | null;
  connected_since: number;
  job_count: number;
};

export async function get_account(): Promise<AccountInfo> {
  return api<AccountInfo>("GET", "/api/account");
}

/** Download everything the server stores about the user as a JSON file. */
export function download_my_data(): void {
  const a = document.createElement("a");
  a.href = "/api/account/export";
  a.download = "dreamcatcher-data.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Disconnect and erase everything, then return to the sign-in screen. */
export async function delete_account(): Promise<void> {
  await api("POST", "/api/account/delete");
  current_user = null;
  sessionStorage.removeItem("dreamcatcher:synced");
  window.location.reload();
}
