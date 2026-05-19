export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export class FetchJsonError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FetchJsonError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorLabel(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export async function fetchJson<T>(url: string, optionsOrTimeoutMs: FetchJsonOptions | number = {}): Promise<T> {
  const options: FetchJsonOptions = typeof optionsOrTimeoutMs === 'number' ? { timeoutMs: optionsOrTimeoutMs } : optionsOrTimeoutMs;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 350;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: options.method,
        body: options.body,
        signal: controller.signal,
        headers: { 'user-agent': 'xpr-arb-radar/0.1 (+https://github.com/charliebot87/xpr-arb-radar)', ...options.headers },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt > retries) break;
      await sleep(retryDelayMs * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new FetchJsonError(`${errorLabel(lastError)} after ${retries + 1} attempts for ${url}`, url, retries + 1, lastError);
}
