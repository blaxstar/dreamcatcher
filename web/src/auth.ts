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
  window.location.reload();
}
