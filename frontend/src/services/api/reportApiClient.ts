import type { MetricRow, MetricSection, Period, ReportPoint } from '../report/reportCatalog';
import type {
    CrmSource,
    EmployeeMetricItem,
    MetricDetailItem,
    ReportLoadFilters,
    SourceMetricsData,
    ValueStateMap,
} from '../report/reportTypes';

export type ReportCatalogResponse = {
    ok: boolean;
    periods: Array<{ value: Period; label: string }>;
    sources: CrmSource[];
    metricSections: MetricSection[];
    metrics: MetricRow[];
};

export type ReportPreviewResponse = {
    ok: boolean;
    status?: string;
    sessionKey?: string;
    filtersHash?: string;
    message?: string;
    filters?: ReportLoadFilters;
    data: ReportPoint[];
    chart_data?: ReportPoint[];
    employees: EmployeeMetricItem[];
    details: MetricDetailItem[];
    source_metrics?: Record<string, SourceMetricsData>;
    chart_source_metrics?: Record<string, SourceMetricsData>;
    metadata?: {
        valueStates?: ValueStateMap;
        [key: string]: unknown;
    };
};

export type PortalEmployeeItem = {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    isActive?: boolean;
    isRobot?: boolean;
    isTechnical?: boolean;
    workPosition?: string | null;
    department?: string | null;
    departmentIds?: string[];
    departments?: Array<{ id: string; name: string }>;
};

export type PortalEmployeesResponse = {
    ok: boolean;
    employees: PortalEmployeeItem[];
};

const REPORT_PREVIEW_POLL_INTERVAL_MS = 1500;
const REPORT_PREVIEW_MAX_POLL_ATTEMPTS = 800;

const getApiBaseUrl = () => {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

    if (!apiBaseUrl) {
        throw new Error('VITE_API_BASE_URL is not set. Check frontend/.env and restart Vite.');
    }

    return apiBaseUrl.replace(/\/+$/, '');
};

const buildApiUrl = (path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${getApiBaseUrl()}${normalizedPath}`;
};

const getBitrixContext = () => {
    if (typeof window === 'undefined') {
        return {};
    }

    const params = new URLSearchParams(window.location.search);
    const context: Record<string, string> = {};
    const memberId = params.get('member_id') || params.get('memberId');
    const domain = params.get('DOMAIN') || params.get('domain');
    const userId = params.get('user_id') || params.get('USER_ID') || params.get('bitrixUserId');
    const portalToken = params.get('portal_token') || params.get('portalToken');

    if (memberId) {
        context.memberId = memberId;
    }

    if (domain) {
        context.domain = domain;
    }

    if (userId) {
        context.bitrixUserId = userId;
    }

    if (portalToken) {
        context.portalToken = portalToken;
    }

    return context;
};

const appendQuery = (path: string, query: Record<string, string>) => {
    const entries = Object.entries(query).filter(([, value]) => value);

    if (!entries.length) {
        return path;
    }

    const separator = path.includes('?') ? '&' : '?';
    const params = new URLSearchParams(entries);

    return `${path}${separator}${params.toString()}`;
};

/** Shared with App UI: long-idle tabs often hit proxy 502/504 that need a full page reload. */
export const RELOAD_PAGE_TO_CONTINUE_MESSAGE =
    'Сессия устарела или соединение прервано. Обновите страницу, чтобы продолжить работу.';

const GATEWAY_RELOAD_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

const getErrorMessage = (payload: unknown, fallback: string) => {
    if (!payload || typeof payload !== 'object') {
        return fallback;
    }

    const record = payload as Record<string, unknown>;

    if (typeof record.error === 'string') {
        const details = record.details;

        if (details && typeof details === 'object') {
            const detailsRecord = details as Record<string, unknown>;

            if (typeof detailsRecord.message === 'string') {
                return `${record.error} ${detailsRecord.message}`;
            }
        }

        return record.error;
    }

    if (typeof record.message === 'string') {
        return record.message;
    }

    if (typeof record.detail === 'string') {
        return record.detail;
    }

    return fallback;
};

export const isReloadRequiredErrorMessage = (message: string) => {
    const normalized = message.toLowerCase();

    if (!normalized) {
        return false;
    }

    const statusMatch = normalized.match(/\b(502|503|504|520|521|522|523|524)\b/);
    if (statusMatch && GATEWAY_RELOAD_STATUSES.has(Number(statusMatch[1]))) {
        return true;
    }

    return (
        normalized.includes('oauth')
        || normalized.includes('access_token')
        || normalized.includes('refresh_token')
        || normalized.includes('authorization')
        || normalized.includes('unauthorized')
        || normalized.includes('token')
        || normalized.includes('токен')
        || normalized.includes('bad signature')
        || normalized.includes('portal token')
        || normalized.includes('gateway')
        || normalized.includes('bad gateway')
        || normalized.includes('service unavailable')
        || normalized.includes('timed out')
        || normalized.includes('gateway timeout')
        || normalized.includes('failed to fetch')
        || normalized.includes('networkerror')
        || normalized.includes('load failed')
        || normalized.includes('empty response')
        || normalized.includes('<html')
        || normalized.includes('nginx')
        || normalized.includes('cloudflare')
        || normalized.includes(RELOAD_PAGE_TO_CONTINUE_MESSAGE.toLowerCase())
    );
};

const toApiErrorMessage = (status: number, payload: unknown) => {
    if (GATEWAY_RELOAD_STATUSES.has(status)) {
        return RELOAD_PAGE_TO_CONTINUE_MESSAGE;
    }

    const fallback = `Backend API request failed with status ${status}`;
    const message = getErrorMessage(payload, fallback);

    if (isReloadRequiredErrorMessage(message)) {
        return RELOAD_PAGE_TO_CONTINUE_MESSAGE;
    }

    return message;
};

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    let response: Response;

    try {
        response = await fetch(buildApiUrl(path), {
            ...options,
            headers: {
                Accept: 'application/json',
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...options.headers,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (isReloadRequiredErrorMessage(message) || !message) {
            throw new Error(RELOAD_PAGE_TO_CONTINUE_MESSAGE);
        }
        throw error instanceof Error ? error : new Error(String(error));
    }

    let payload: unknown = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(toApiErrorMessage(response.status, payload));
    }

    if (payload === null) {
        throw new Error(RELOAD_PAGE_TO_CONTINUE_MESSAGE);
    }

    return payload as T;
};

let reportCatalogPromise: Promise<ReportCatalogResponse> | null = null;

export const loadReportCatalog = () => {
    if (!reportCatalogPromise) {
        reportCatalogPromise = requestJson<ReportCatalogResponse>(
            appendQuery('/api/reports/catalog/', getBitrixContext()),
        ).catch((error) => {
            reportCatalogPromise = null;
            throw error;
        });
    }

    return reportCatalogPromise;
};

export const loadPortalEmployees = () =>
    requestJson<PortalEmployeesResponse>(
        appendQuery('/api/reports/employees/', getBitrixContext()),
    ).then((response) => response.employees);

export const loadReportPreview = (filters: ReportLoadFilters) =>
    requestJson<ReportPreviewResponse>('/api/reports/preview/', {
        method: 'POST',
        body: JSON.stringify({
            ...getBitrixContext(),
            ...filters,
        }),
    }).then(waitForReportPreview);

const loadReportPreviewStatus = (sessionKey: string) =>
    requestJson<ReportPreviewResponse>(
        appendQuery(`/api/reports/preview/${sessionKey}/`, getBitrixContext()),
    );

const waitForReportPreview = async (preview: ReportPreviewResponse) => {
    if (preview.status !== 'queued' && preview.status !== 'running') {
        return preview;
    }

    if (!preview.sessionKey) {
        throw new Error('Backend queued report build without session key.');
    }

    let current = preview;

    for (let attempt = 0; attempt < REPORT_PREVIEW_MAX_POLL_ATTEMPTS; attempt += 1) {
        await delay(REPORT_PREVIEW_POLL_INTERVAL_MS);
        current = await loadReportPreviewStatus(preview.sessionKey);

        if (current.status === 'ready') {
            return current;
        }

        if (current.status === 'failed') {
            const message = current.message || 'Не удалось построить отчет.';
            throw new Error(
                isReloadRequiredErrorMessage(message) ? RELOAD_PAGE_TO_CONTINUE_MESSAGE : message,
            );
        }
    }

    throw new Error('Отчет строится слишком долго. Попробуйте выбрать меньший период или повторить позже.');
};

const delay = (ms: number) =>
    new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });

// --- Report Settings Persistence ---

export type ReportSettingsResponse = {
    ok: boolean;
    settings: Record<string, unknown>;
    savedViews: Array<Record<string, unknown>>;
    appSettings: Record<string, unknown>;
    detailColumnWidths: Record<string, unknown>;
};

export type ReportSettingsSavePayload = {
    settings: Record<string, unknown>;
    savedViews: Array<Record<string, unknown>>;
    appSettings: Record<string, unknown>;
    detailColumnWidths: Record<string, unknown>;
};

export type ReportSettingsSaveResponse = {
    ok: boolean;
    created: boolean;
    lastSavedAt: string;
};

export const loadReportSettings = () =>
    requestJson<ReportSettingsResponse>(
        appendQuery('/api/reports/settings/', getBitrixContext()),
    );

export const saveReportSettings = (payload: ReportSettingsSavePayload) =>
    requestJson<ReportSettingsSaveResponse>('/api/reports/settings/save/', {
        method: 'POST',
        body: JSON.stringify({
            ...getBitrixContext(),
            ...payload,
        }),
    });
