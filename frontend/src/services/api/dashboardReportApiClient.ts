import type { PortalEmployeeItem, ReportCatalogResponse, ReportPreviewResponse } from './reportApiClient';
import type { ReportLoadFilters } from '../report/reportTypes';

const getApiBaseUrl = () => {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

  if (!apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL is not set. Check dashboard-frontend/.env and restart Vite.');
  }

  return apiBaseUrl.replace(/\/+$/, '');
};

const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${getApiBaseUrl()}${normalizedPath}`;
};

const getErrorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.error === 'string') {
    return record.error;
  }

  if (typeof record.message === 'string') {
    return record.message;
  }

  return fallback;
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
    throw new Error(getErrorMessage(payload, `Dashboard API request failed with status ${response.status}`));
  }

  return payload as T;
};

let dashboardCatalogPromise: Promise<ReportCatalogResponse> | null = null;

export const loadDashboardReportCatalog = () => {
  if (!dashboardCatalogPromise) {
    dashboardCatalogPromise = requestJson<ReportCatalogResponse>('/api/dashboard/owner/catalog/').catch((error) => {
      dashboardCatalogPromise = null;
      throw error;
    });
  }

  return dashboardCatalogPromise;
};

export const loadDashboardReportPreview = (_filters: ReportLoadFilters) =>
  requestJson<ReportPreviewResponse>('/api/dashboard/owner/preview/', {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const loadDashboardPortalEmployees = () =>
  requestJson<{ ok: boolean; employees: PortalEmployeeItem[] }>('/api/dashboard/owner/employees/')
    .then((response) => response.employees);
