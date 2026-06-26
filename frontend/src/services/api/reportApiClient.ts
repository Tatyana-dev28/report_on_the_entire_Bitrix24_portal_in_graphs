import type { MetricRow, MetricSection, Period, ReportPoint } from '../report/reportCatalog';
import type {
    CrmSource,
    EmployeeMetricItem,
    MetricDetailItem,
    ReportLoadFilters,
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
    employees: EmployeeMetricItem[];
    details: MetricDetailItem[];
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

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(buildApiUrl(path), {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
        },
    });

    let payload: unknown = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(
            getErrorMessage(payload, `Backend API request failed with status ${response.status}`),
        );
    }

    if (payload === null) {
        throw new Error('Backend API returned an empty response.');
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
            throw new Error(current.message || 'Не удалось построить отчет.');
        }
    }

    throw new Error('Отчет строится слишком долго. Попробуйте выбрать меньший период или повторить позже.');
};

const delay = (ms: number) =>
    new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
