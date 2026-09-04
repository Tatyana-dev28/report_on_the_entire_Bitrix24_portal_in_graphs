import type { MetricRow } from '../../services/report/reportCatalog';
import type { BitrixEntityType, DetailRow } from '../types';

type BX24Api = {
  init?: (callback: () => void) => void;
  openPath?: (
    path: string,
    callback?: (result?: { error?: string; errorDescription?: string; error_description?: string }) => void,
  ) => void;
  slider?: {
    open?: (path: string, options?: Record<string, unknown>) => void;
  };
};

export type BitrixOpenResult = 'opened' | 'unavailable' | 'access_denied';

const classifyBitrixOpenError = (result?: {
  error?: string;
  errorDescription?: string;
  error_description?: string;
}): BitrixOpenResult => {
  const raw = [
    result?.error,
    result?.errorDescription,
    result?.error_description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!raw) {
    return 'opened';
  }

  if (
    raw.includes('access')
    || raw.includes('denied')
    || raw.includes('permission')
    || raw.includes('forbidden')
    || raw.includes('доступ')
  ) {
    return 'access_denied';
  }

  return 'unavailable';
};

export const bitrixEntityLabels: Record<BitrixEntityType, string> = {
  deal: 'сделки',
  lead: 'лиды',
  invoice: 'счета',
  quote: 'предложения',
  company: 'компании',
  contact: 'контакты',
  task: 'задачи',
  activity: 'дела',
  call: 'звонки',
  email: 'письма',
  message: 'сообщения',
  crm_form: 'CRM формы',
};

export const bitrixEntityTitleRoots: Record<BitrixEntityType, string> = {
  deal: 'Сделка',
  lead: 'Лид',
  invoice: 'Счет',
  quote: 'Предложение',
  company: 'Компания',
  contact: 'Контакт',
  task: 'Задача',
  activity: 'Дело',
  call: 'Звонок',
  email: 'Письмо',
  message: 'Сообщение',
  crm_form: 'CRM форма',
};

const getBitrixEntityPath = (entityType: BitrixEntityType, id: string | number) => {
  const paths: Record<BitrixEntityType, string> = {
    deal: `/crm/deal/details/${id}/`,
    lead: `/crm/lead/details/${id}/`,
    invoice: `/crm/type/31/details/${id}/`,
    quote: `/crm/quote/details/${id}/`,
    company: `/crm/company/details/${id}/`,
    contact: `/crm/contact/details/${id}/`,
    task: `/company/personal/user/0/tasks/task/view/${id}/`,
    // open_view opens the activity slider/card; bare ?ID= often lands on a list.
    activity: `/crm/activity/?open_view=${id}`,
    // Last-resort for statistic-row id without CRM link: filter the grid to that row.
    call: `/telephony/detail.php?apply_filter=Y&FILTER[ID]=${id}`,
    email: `/crm/activity/?open_view=${id}`,
    message: `/crm/activity/?open_view=${id}`,
    crm_form: `/crm/webform/result/${id}/`,
  };

  return paths[entityType];
};

const getNumericId = (id: string | number | undefined | null) => {
  const numericId = Number(id);

  return Number.isFinite(numericId) && numericId > 0 ? numericId : null;
};

const getNumericEntityTypeId = (id: string | number | undefined | null) => {
  const numericId = Number(id);

  return Number.isFinite(numericId) && numericId > 0 ? numericId : null;
};

const getSmartEntityTypeIdFromSource = (sourceId: string | undefined) => {
  const match = sourceId?.match(/^smart-(\d+)(?:-|$)/);

  return match ? Number(match[1]) : null;
};

const getEntityFromCrmFormFallbackId = (id: string | number | undefined | null) => {
  const match = String(id ?? '').match(/^(lead|deal)-form-(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    entityType: match[1] as BitrixEntityType,
    entityId: Number(match[2]),
  };
};

const getBitrixPortalOrigin = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const domain = params.get('DOMAIN') || params.get('domain');

  if (domain) {
    const normalizedDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

    return normalizedDomain ? `https://${normalizedDomain}` : null;
  }

  try {
    const storedDomain = window.sessionStorage.getItem('sapp_dashboard_portal_domain');
    if (storedDomain) {
      const normalizedDomain = storedDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      return normalizedDomain ? `https://${normalizedDomain}` : null;
    }
  } catch {
    // ignore storage errors
  }

  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;

    return referrer?.origin || null;
  } catch {
    return null;
  }
};

const openBitrixPathFallback = (path: string, fallback: Record<string, unknown>) => {
  const portalOrigin = getBitrixPortalOrigin();

  if (!portalOrigin) {
    console.info('[mock Bitrix24] open path', { ...fallback, path });
    return;
  }

  window.open(`${portalOrigin}${path}`, '_blank', 'noopener,noreferrer');
};

export const getBitrixDetailRowPath = (row: DetailRow) => {
  const crmFormFallbackEntity = row.entityType === 'crm_form'
    ? getEntityFromCrmFormFallbackId(row.entityRawId ?? row.entityId)
    : null;
  const entityType = row.navigationEntityType ?? crmFormFallbackEntity?.entityType ?? row.entityType;
  const entityId = getNumericId(
    row.navigationEntityId ?? crmFormFallbackEntity?.entityId ?? row.entityRawId ?? row.entityId,
  );

  if (entityId === null) {
    return null;
  }

  const smartEntityTypeId = getNumericEntityTypeId(row.navigationEntityTypeId)
    ?? getSmartEntityTypeIdFromSource(row.sourceId);

  if (smartEntityTypeId) {
    return `/crm/type/${smartEntityTypeId}/details/${entityId}/`;
  }

  return getBitrixEntityPath(entityType, entityId);
};

const openBitrixPath = (
  path: string,
  fallback: Record<string, unknown>,
  onResult?: (result: BitrixOpenResult) => void,
) => {
  const bx24 = (window as Window & { BX24?: BX24Api }).BX24;
  const notify = (result: BitrixOpenResult) => {
    onResult?.(result);
  };
  const openWithSdk = () => {
    if (bx24?.openPath) {
      bx24.openPath(path, (result) => {
        notify(classifyBitrixOpenError(result));
      });
      return true;
    }

    if (bx24?.slider?.open) {
      bx24.slider.open(path);
      notify('opened');
      return true;
    }

    return false;
  };

  try {
    if (bx24?.init) {
      bx24.init(() => {
        if (!openWithSdk()) {
          openBitrixPathFallback(path, fallback);
          notify('opened');
        }
      });
      return;
    }

    if (openWithSdk()) {
      return;
    }
  } catch (error) {
    console.warn('[Bitrix24] open path failed', { ...fallback, path, error });
    notify('unavailable');
    return;
  }

  openBitrixPathFallback(path, fallback);
  notify('opened');
};

export function openBitrixEntity(entityType: BitrixEntityType, id: string | number) {
  const numericId = getNumericId(id);

  if (numericId === null) {
    return;
  }

  openBitrixPath(getBitrixEntityPath(entityType, numericId), { entityType, id: numericId });
}

export function openBitrixDetailRow(
  row: DetailRow,
  onResult?: (result: BitrixOpenResult) => void,
) {
  const path = getBitrixDetailRowPath(row);

  if (!path) {
    onResult?.('unavailable');
    return;
  }

  openBitrixPath(path, {
    entityType: row.navigationEntityType ?? row.entityType,
    entityId: row.entityId,
    navigationEntityId: row.navigationEntityId,
    sourceId: row.sourceId,
  }, onResult);
}

export function openBitrixUser(userId: string | number) {
  const numericUserId = getNumericId(userId);

  if (numericUserId === null) {
    return;
  }

  openBitrixPath(`/company/personal/user/${numericUserId}/`, { userId: numericUserId });
}

/** Absolute Bitrix24 URL for Excel/PDF hyperlinks (F-22). */
export const buildBitrixAbsoluteUrl = (path: string | null | undefined): string | null => {
  if (!path) {
    return null;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const portalOrigin = getBitrixPortalOrigin();

  if (!portalOrigin) {
    return normalizedPath;
  }

  return `${portalOrigin}${normalizedPath}`;
};

export const buildBitrixDetailRowUrl = (row: DetailRow): string | null =>
  buildBitrixAbsoluteUrl(getBitrixDetailRowPath(row));

export const buildBitrixUserUrl = (userId: string | number): string | null => {
  const numericUserId = getNumericId(userId);
  if (numericUserId === null) {
    return null;
  }

  return buildBitrixAbsoluteUrl(`/company/personal/user/${numericUserId}/`);
};

const normalizeEntityType = (value: string | undefined | null): BitrixEntityType | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const supported: BitrixEntityType[] = [
    'deal',
    'lead',
    'invoice',
    'quote',
    'company',
    'contact',
    'task',
    'activity',
    'call',
    'email',
    'message',
    'crm_form',
  ];

  return supported.includes(normalized as BitrixEntityType)
    ? (normalized as BitrixEntityType)
    : null;
};

/** Build absolute entity URL from report detail payload fields. */
export const buildBitrixMetricDetailUrl = (detail: {
  entityId?: string | number;
  entityType?: string;
  sourceId?: string;
  navigationEntityId?: string | number;
  navigationEntityType?: string;
  navigationEntityTypeId?: string | number;
  title?: string;
}): string | null => {
  const entityType = normalizeEntityType(detail.navigationEntityType)
    ?? normalizeEntityType(detail.entityType)
    ?? 'deal';

  const syntheticRow: DetailRow = {
    rowNumber: 1,
    entityId: Number(detail.entityId) || 0,
    entityRawId: detail.entityId,
    title: detail.title ?? '',
    linkedElementTitle: '',
    responsibleId: 0,
    responsibleName: '',
    createdAt: '',
    createdAtSortValue: 0,
    entityType,
    sourceId: detail.sourceId,
    navigationEntityId: detail.navigationEntityId,
    navigationEntityType: normalizeEntityType(detail.navigationEntityType) ?? undefined,
    navigationEntityTypeId: detail.navigationEntityTypeId,
  };

  return buildBitrixDetailRowUrl(syntheticRow);
};

export const getEntityTypeForMetric = (metric: MetricRow, sectionId?: string): BitrixEntityType => {
  if (metric.id.startsWith('deals_') || metric.id.startsWith('sales_')) {
    return 'deal';
  }

  if (metric.id.startsWith('leads_') || metric.id.startsWith('lead_')) {
    return 'lead';
  }

  if (metric.id.startsWith('invoices_')) {
    return 'invoice';
  }

  if (metric.id.startsWith('quotes_')) {
    return 'quote';
  }

  if (metric.id === 'companies_new') {
    return 'company';
  }

  if (metric.id === 'contacts_new') {
    return 'contact';
  }

  if (metric.id.startsWith('tasks_')) {
    return 'task';
  }

  if (metric.id.startsWith('activities_') || metric.id.startsWith('production_')) {
    return 'activity';
  }

  if (metric.id.startsWith('calls_')) {
    return 'call';
  }

  if (metric.id.startsWith('email_')) {
    return 'email';
  }

  if (metric.id.startsWith('messages_')) {
    return 'message';
  }

  return 'crm_form';
};
