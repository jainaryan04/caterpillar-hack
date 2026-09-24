/** Small fetch wrapper shared by the backend clients. */

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the server could not be reached. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get unreachable() {
    return this.status === 0;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON-serialised unless it is FormData. */
  body?: unknown;
  timeoutMs?: number;
}

export async function request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 10000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const send = () =>
    fetch(`${baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

  let res: Response;
  try {
    try {
      res = await send();
    } catch (e) {
      // A pooled connection the server already closed fails at once; a fresh one works. Try once more.
      if (isAbort(e)) throw e;
      res = await send();
    }
  } catch (e) {
    throw new ApiError(isAbort(e) ? 'The server took too long to respond.' : 'Cannot reach the server.', 0);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // FastAPI puts the reason in `detail` (a string, or a list for 422s).
    const payload = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = payload?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? 'The server rejected the request.'
          : `Server error (${res.status}).`;
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}
