import { dashboardConfig } from '../app/config';
import type { DashboardAccessConfirmResponse, OwnerDashboardBootstrap } from './types';

const buildApiUrl = (path: string) => {
  if (!dashboardConfig.apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL is not set.');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${dashboardConfig.apiBaseUrl}${normalizedPath}`;
};

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(buildApiUrl(path), {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Dashboard API request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload as T;
};

const getDashboardContext = () => {
  const params = new URLSearchParams(window.location.search);

  return {
    memberId: params.get('memberId') || params.get('member_id') || '',
    domain: params.get('domain') || params.get('DOMAIN') || '',
    bitrixUserId: params.get('bitrixUserId') || params.get('user_id') || params.get('USER_ID') || '',
    portalToken: params.get('portalToken') || params.get('portal_token') || '',
  };
};

export const loadOwnerDashboardBootstrap = () =>
  requestJson<OwnerDashboardBootstrap>('/api/dashboard/owner/bootstrap/');

export const confirmOwnerDashboardAccess = (trusted: boolean) =>
  requestJson<DashboardAccessConfirmResponse>('/api/dashboard/owner/access/confirm/', {
    method: 'POST',
    body: JSON.stringify({
      ...getDashboardContext(),
      trusted,
    }),
  });

export const endOwnerDashboardAccess = () =>
  requestJson<{ ok: boolean; ended: boolean }>('/api/dashboard/owner/access/end/', {
    method: 'POST',
    body: JSON.stringify({}),
  });
