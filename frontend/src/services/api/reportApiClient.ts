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
    filters?: ReportLoadFilters;
    data: ReportPoint[];
    employees: EmployeeMetricItem[];
    details: MetricDetailItem[];
};

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
        reportCatalogPromise = requestJson<ReportCatalogResponse>('/api/reports/catalog/').catch(
            (error) => {
                reportCatalogPromise = null;
                throw error;
            },
        );
    }

    return reportCatalogPromise;
};

export const loadReportPreview = (filters: ReportLoadFilters) =>
    requestJson<ReportPreviewResponse>('/api/reports/preview/', {
        method: 'POST',
        body: JSON.stringify(filters),
    });