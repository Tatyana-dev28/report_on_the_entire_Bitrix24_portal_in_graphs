import type { MetricRow } from '../../services/report/reportCatalog';
import type { BitrixEntityType } from '../types';

type BX24Api = {
  openPath?: (path: string) => void;
  slider?: {
    open?: (path: string) => void;
  };
};

export const bitrixEntityLabels: Record<BitrixEntityType, string> = {
  deal: 'СЃРґРµР»РєРё',
  lead: 'Р»РёРґС‹',
  invoice: 'СЃС‡РµС‚Р°',
  quote: 'РїСЂРµРґР»РѕР¶РµРЅРёСЏ',
  company: 'РєРѕРјРїР°РЅРёРё',
  contact: 'РєРѕРЅС‚Р°РєС‚С‹',
  task: 'Р·Р°РґР°С‡Рё',
  activity: 'РґРµР»Р°',
  call: 'Р·РІРѕРЅРєРё',
  email: 'РїРёСЃСЊРјР°',
  message: 'СЃРѕРѕР±С‰РµРЅРёСЏ',
  crm_form: 'CRM С„РѕСЂРјС‹',
};

export const bitrixEntityTitleRoots: Record<BitrixEntityType, string> = {
  deal: 'РЎРґРµР»РєР°',
  lead: 'Р›РёРґ',
  invoice: 'РЎС‡РµС‚',
  quote: 'РџСЂРµРґР»РѕР¶РµРЅРёРµ',
  company: 'РљРѕРјРїР°РЅРёСЏ',
  contact: 'РљРѕРЅС‚Р°РєС‚',
  task: 'Р—Р°РґР°С‡Р°',
  activity: 'Р”РµР»Рѕ',
  call: 'Р—РІРѕРЅРѕРє',
  email: 'РџРёСЃСЊРјРѕ',
  message: 'РЎРѕРѕР±С‰РµРЅРёРµ',
  crm_form: 'CRM С„РѕСЂРјР°',
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

export function openBitrixEntity(entityType: BitrixEntityType, id: string | number) {
  const path = getBitrixEntityPath(entityType, id);
  const bx24 = (window as Window & { BX24?: BX24Api }).BX24;

  if (bx24?.openPath) {
    bx24.openPath(path);
    return;
  }

  if (bx24?.slider?.open) {
    bx24.slider.open(path);
    return;
  }

  console.info('[mock Bitrix24] open entity', { entityType, id, path });
}

export function openBitrixUser(userId: string | number) {
  const path = `/company/personal/user/${userId}/`;
  const bx24 = (window as Window & { BX24?: BX24Api }).BX24;

  if (bx24?.openPath) {
    bx24.openPath(path);
    return;
  }

  if (bx24?.slider?.open) {
    bx24.slider.open(path);
    return;
  }

  console.info('[mock Bitrix24] open user', { userId, path });
}

export const getEntityTypeForMetric = (metric: MetricRow, sectionId?: string): BitrixEntityType => {
  if (metric.id.startsWith('deals_') || metric.id.startsWith('sales_') || sectionId === 'sales_funnel') {
    return 'deal';
  }

  if (metric.id.startsWith('leads_') || metric.id.startsWith('lead_') || sectionId === 'lead_funnel') {
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

  if (metric.id.startsWith('activities_') || metric.id.startsWith('production_') || sectionId === 'production_funnel') {
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
