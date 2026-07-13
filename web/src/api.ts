export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });

  if (res.status === 401) {
    throw new ApiError(401, "unauthorized");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
