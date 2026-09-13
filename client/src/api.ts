export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(base + '/api/admin' + path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'PulseAdmin',
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith('/login'))
      window.dispatchEvent(new Event('pulse:unauthorized'));
    throw new ApiError(data.message || '请求失败', response.status);
  }
  return data;
}
export const post = (path: string, data: unknown = {}) =>
  api(path, { method: 'POST', body: JSON.stringify(data) });
export const put = (path: string, data: unknown) =>
  api(path, { method: 'PUT', body: JSON.stringify(data) });
export const patch = (path: string, data: unknown) =>
  api(path, { method: 'PATCH', body: JSON.stringify(data) });
export function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value.replace(' ', 'T') + 'Z'))
    : '—';
}
