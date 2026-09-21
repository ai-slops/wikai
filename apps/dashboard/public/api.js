let csrfToken = "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.method && options.method !== "GET") headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...options, headers });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export async function initializeSession() {
  const session = await request("/session");
  csrfToken = session.csrfToken;
}

export const api = {
  status: () => request("/status"),
  detail: (id) => request(`/publications/${encodeURIComponent(id)}`),
  preview: (mode, id) =>
    request(`/publications/${encodeURIComponent(id)}/preview?mode=${encodeURIComponent(mode)}`),
  approve: (id, expectedHash) =>
    request(`/publications/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ expectedHash }),
    }),
  withdraw: (id, expectedHash, redirect) =>
    request(`/publications/${encodeURIComponent(id)}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ expectedHash, ...(redirect ? { redirect } : {}) }),
    }),
  create: (action, input) => request(`/${action}`, { method: "POST", body: JSON.stringify(input) }),
  build: () => request("/build", { method: "POST" }),
  updateMetadata: (id, expectedHash, patch) =>
    request(`/publications/${encodeURIComponent(id)}/metadata`, {
      method: "PATCH",
      body: JSON.stringify({ expectedHash, patch }),
    }),
  restore: (id, revisionHash, expectedHash) =>
    request(`/publications/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: JSON.stringify({ revisionHash, expectedHash }),
    }),
};
