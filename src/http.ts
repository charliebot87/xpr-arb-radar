export async function fetchJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'xpr-arb-radar/0.1 (+https://github.com/charliebot87/xpr-arb-radar)' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
