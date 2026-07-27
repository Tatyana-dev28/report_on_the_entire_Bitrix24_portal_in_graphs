import type { MetricRow } from '../../services/report/reportCatalog';
import type { BitrixEntityType, DetailRow } from '../types';

type BX24Api = {
  init?: (callback: () => void) => void;
  openPath?: (path: string, callback?: () => void) => void;
  slider?: {
    open?: (path: string, options?: Record<string, unknown>) => void;
  };
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
    activity: `/crm/activity/?ID=${id}`,
    call: `/crm/activity/?ID=${id}`,
    email: `/crm/activity/?ID=${id}`,
    message: `/crm/activity/?ID=${id}`,
    crm_form: `/crm/webform/result/${id}/`,
  };

  return paths[entityType];
};

const getNumericId = (id: string | number | undefined | null) => {
  const numericId = Number(id);

  return Number.isFinite(numericId) && numericId > 0 ? numericId : null;
};

const getSmartEntityTypeIdFromSource = (sourceId: string | undefined) => {
  const match = sourceId?.match(/^smart-(\d+)(?:-|$)/);

  return match ? Number(match[1]) : null;
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
  const entityId = getNumericId(row.entityRawId ?? row.entityId);

  if (entityId === null) {
    return null;
  }

  const smartEntityTypeId = getSmartEntityTypeIdFromSource(row.sourceId);

  if (smartEntityTypeId) {
    return `/crm/type/${smartEntityTypeId}/details/${entityId}/`;
  }

  return getBitrixEntityPath(row.entityType, entityId);
};

const openBitrixPath = (path: string, fallback: Record<string, unknown>) => {
  const bx24 = (window as Window & { BX24?: BX24Api }).BX24;
  const openWithSdk = () => {
    if (bx24?.openPath) {
      bx24.openPath(path);
      return true;
    }

    if (bx24?.slider?.open) {
      bx24.slider.open(path);
      return true;
    }

    return false;
  };

  try {
    if (bx24?.init) {
      bx24.init(() => {
        if (!openWithSdk()) {
          openBitrixPathFallback(path, fallback);
        }
      });
      return;
    }

    if (openWithSdk()) {
      return;
    }
  } catch (error) {
    console.warn('[Bitrix24] open path failed', { ...fallback, path, error });
  }

  openBitrixPathFallback(path, fallback);
};

export function openBitrixEntity(entityType: BitrixEntityType, id: string | number) {
  const numericId = getNumericId(id);

  if (numericId === null) {
    return;
  }

  openBitrixPath(getBitrixEntityPath(entityType, numericId), { entityType, id: numericId });
}

export function openBitrixDetailRow(row: DetailRow) {
  const path = getBitrixDetailRowPath(row);

  if (!path) {
    return;
  }

  openBitrixPath(path, {
    entityType: row.entityType,
    entityId: row.entityId,
    sourceId: row.sourceId,
  });
}

export function openBitrixUser(userId: string | number) {
  const numericUserId = getNumericId(userId);

  if (numericUserId === null) {
    return;
  }

  openBitrixPath(`/company/personal/user/${numericUserId}/`, { userId: numericUserId });
}

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
