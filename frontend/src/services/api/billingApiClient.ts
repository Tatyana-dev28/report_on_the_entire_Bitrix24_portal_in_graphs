type BillingAccess = {
    accessLevel: string;
    hasPro: boolean;
    isLifetime: boolean;
    validUntil: string | null;
    features: Record<string, unknown>;
    limits: Record<string, unknown>;
};

export type BillingPlan = {
    code: string;
    name: string;
    description: string;
    price: string;
    currency: string;
    billingPeriod: string;
    durationMonths: number | null;
    features: Record<string, unknown>;
    limits: Record<string, unknown>;
};

export type BillingStateResponse = {
    ok: boolean;
    access: BillingAccess;
    plans: BillingPlan[];
};

export type CreatePaymentResponse = {
    ok: boolean;
    payment: {
        id: string;
        orderId: string;
        status: string;
        amount: string;
        currency: string;
        paymentUrl: string;
        expiresAt: string | null;
    };
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

export const getBitrixContext = () => {
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

export const loadBillingState = () =>
    requestJson<BillingStateResponse>(
        appendQuery('/api/billing/access/', getBitrixContext()),
    );

export const createProPayment = (customerEmail: string, planCode = 'pro_monthly') =>
    requestJson<CreatePaymentResponse>('/api/billing/payments/', {
        method: 'POST',
        body: JSON.stringify({
            ...getBitrixContext(),
            planCode,
            customerEmail,
        }),
    });
