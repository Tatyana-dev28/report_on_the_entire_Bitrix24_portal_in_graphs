import type { PortalEmployeeItem, ReportCatalogResponse, ReportPreviewResponse, ReportSettingsResponse } from './reportApiClient';
import type { ReportLoadFilters } from '../report/reportTypes';

export type DashboardViewerMode = 'owner' | 'share';

let dashboardViewerMode: DashboardViewerMode = 'owner';

export const setDashboardViewerMode = (mode: DashboardViewerMode) => {
  dashboardViewerMode = mode;
};

export const getDashboardViewerMode = () => dashboardViewerMode;

export const isDashboardShareViewer = () =>
  import.meta.env.VITE_APP_MODE === 'dashboard' && dashboardViewerMode === 'share';

const dashboardApiPrefix = () => (dashboardViewerMode === 'share' ? '/api/dashboard/share' : '/api/dashboard/owner');

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
    dashboardCatalogPromise = requestJson<ReportCatalogResponse>(`${dashboardApiPrefix()}/catalog/`).catch((error) => {
      dashboardCatalogPromise = null;
      throw error;
    });
  }

  return dashboardCatalogPromise;
};

export const loadDashboardReportPreview = (_filters: ReportLoadFilters) =>
  requestJson<ReportPreviewResponse>(`${dashboardApiPrefix()}/preview/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const loadDashboardPortalEmployees = () =>
  requestJson<{ ok: boolean; employees: PortalEmployeeItem[] }>(`${dashboardApiPrefix()}/employees/`)
    .then((response) => response.employees);

export type DashboardShareLinkItem = {
  id: string;
  reportId: string;
  reportName: string;
  expiresAt: string | null;
  disabledAt: string | null;
  isAvailable: boolean;
  fingerprint: string;
  token?: string;
};

export type DashboardOwnerBootstrapResponse = ReportSettingsResponse & {
  access: string;
  viewerMode?: 'owner' | 'share' | 'none';
  portal: { domain: string; memberId: string } | null;
  selectedReportId: string | null;
  hasPreparedData?: boolean;
  refreshStatus: {
    lastSuccessfulUpdateAt: string | null;
    nextUpdateAt: string | null;
    isRefreshing: boolean;
    lastAttemptFailedAt: string | null;
    lastErrorMessage: string;
  } | null;
  share?: DashboardShareLinkItem;
};

export const loadDashboardOwnerBootstrap = () =>
  requestJson<DashboardOwnerBootstrapResponse>(`${dashboardApiPrefix()}/bootstrap/`);

export const loadDashboardOwnerSettings = () =>
  loadDashboardOwnerBootstrap().then((response) => ({
    ok: response.ok,
    settings: response.settings ?? {},
    savedViews: Array.isArray(response.savedViews) ? response.savedViews : [],
    appSettings: response.appSettings ?? {},
    detailColumnWidths: {},
    selectedReportId: response.selectedReportId,
    hasPreparedData: Boolean(response.hasPreparedData),
    refreshStatus: response.refreshStatus,
    portal: response.portal,
  }));

export const endDashboardOwnerAccess = () =>
  requestJson<{ ok: boolean; ended: boolean }>('/api/dashboard/owner/access/end/', {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const requestDashboardOwnerRefresh = (payload: {
  settings?: Record<string, unknown>;
  savedViews?: Array<Record<string, unknown>>;
} = {}) =>
  requestJson<{
    ok: boolean;
    accepted: boolean;
    refreshStatus: DashboardOwnerBootstrapResponse['refreshStatus'];
  }>('/api/dashboard/owner/refresh/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateDashboardRefreshInterval = (refreshIntervalMinutes: 10 | 30 | 60) =>
  requestJson<{
    ok: boolean;
    refreshIntervalMinutes: 10 | 30 | 60;
    refreshStatus: DashboardOwnerBootstrapResponse['refreshStatus'];
  }>('/api/dashboard/owner/refresh-interval/', {
    method: 'POST',
    body: JSON.stringify({ refreshIntervalMinutes }),
  });

export const openDashboardShareAccess = (shareToken: string) =>
  requestJson<DashboardOwnerBootstrapResponse>('/api/dashboard/share/open/', {
    method: 'POST',
    body: JSON.stringify({ shareToken }),
  });

export const listDashboardShareLinks = () =>
  requestJson<{ ok: boolean; shareLinks: DashboardShareLinkItem[] }>('/api/dashboard/owner/share-links/');

export const createDashboardShareLink = (
  reportId: string,
  expiresInDays: number | null,
  extras?: { reportName?: string; savedViews?: unknown[] },
) =>
  requestJson<{ ok: boolean; shareLink: DashboardShareLinkItem }>('/api/dashboard/owner/share-links/', {
    method: 'POST',
    body: JSON.stringify({
      reportId,
      expiresInDays,
      reportName: extras?.reportName,
      savedViews: extras?.savedViews,
    }),
  });

export const disableDashboardShareLink = (id: string) =>
  requestJson<{ ok: boolean; shareLink: DashboardShareLinkItem }>('/api/dashboard/owner/share-links/disable/', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const invalidateDashboardReportCache = () => {
  dashboardCatalogPromise = null;
};
