/**
 * REST client for the NestJS API (live mode). Demo mode uses src/demo/store.ts instead; see src/data/source.tsx.
 * Never put secrets here: the browser only ever holds the user's own short-lived JWT.
 */
// Same-origin on Vercel (the api service is mounted at /api); localhost:3000 in local Vite dev.
const BASE = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '')) + '/api/v1';
let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) { super(message); }
}

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // expired token or deactivated account: end the session and go back to sign-in
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      try { sessionStorage.removeItem('veer-live-session'); } catch { /* ignore */ }
      token = null;
      location.assign('/login?expired=1');
    }
    const issues = (body as { issues?: { path: string; message: string }[] }).issues;
    const msg = issues?.length ? issues.map((i) => `${i.path}: ${i.message}`).join('; ') : (body as { message?: string | string[] }).message;
    throw new ApiError(Array.isArray(msg) ? msg.join('; ') : msg ?? `Request failed (HTTP ${res.status})`, res.status, body);
  }
  return body as T;
}
