import { createClient, removeAccessToken } from '@base44/sdk';

export const base44AppId = import.meta.env.VITE_BASE44_APP_ID;
export const base44ServerUrl = 'https://base44.app';

export const base44 = createClient({
  appId: base44AppId,
  appBaseUrl: base44ServerUrl,
});

export async function loginWithEmailPassword(email, password) {
  const response = await fetch(`${base44ServerUrl}/api/apps/${base44AppId}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-App-Id': base44AppId,
      'X-Origin-URL': window.location.href,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.message || data?.detail || 'Could not log in';
    throw new Error(message);
  }

  if (data.access_token) base44.setToken(data.access_token);
  return data;
}

export function clearBase44Session() {
  removeAccessToken({});
  window.localStorage?.removeItem('token');
}
