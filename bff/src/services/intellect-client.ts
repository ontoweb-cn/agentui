const INTELLECT_HOST = process.env.INTELLECT_HOST || 'localhost';
const INTELLECT_PORT = process.env.PYTHON_API_PORT || '9380';
const BASE_URL = `http://${INTELLECT_HOST}:${INTELLECT_PORT}`;

async function request<T = unknown>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = token;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Intellect API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export const intellectClient = {
  get: <T = unknown>(path: string, token: string, query?: Record<string, string>) =>
    request<T>('GET', path, token, undefined, query),
  post: <T = unknown>(path: string, token: string, body: unknown) =>
    request<T>('POST', path, token, body),
  put: <T = unknown>(path: string, token: string, body: unknown) =>
    request<T>('PUT', path, token, body),
  delete: <T = unknown>(path: string, token: string) =>
    request<T>('DELETE', path, token),
};
