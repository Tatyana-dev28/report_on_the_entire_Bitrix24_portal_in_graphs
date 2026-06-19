import {
  metricSections,
  metrics,
  periodOptions,
  type ReportPoint,
} from './reportCatalog';
import { callBitrixMethod } from '../bitrix/bitrixClient';
import type {
  BitrixDealCategory,
  BitrixSmartProcessCategory,
  BitrixSmartProcessType,
  BitrixStatus,
} from '../bitrix/bitrixTypes';
import type {
  CrmSource,
  EmployeeMetricItem,
  EmployeeMetricRequest,
  MetricDetailsRequest,
  MetricDetailItem,
  ReportDataSource,
  ReportLoadFilters,
} from './reportTypes';

const toArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = record.result ?? record.items ?? record.types ?? record.categories;

    if (Array.isArray(nested)) {
      return nested as T[];
    }
  }

  return [];
};

const defaultCrmSources: CrmSource[] = [
  {
    id: 'lead-default',
    type: 'lead',
    entityTypeId: 1,
    categoryId: null,
    title: 'Р’РѕСЂРѕРЅРєР° Р»РёРґРѕРІ',
    sourceLabel: 'Р›РёРґС‹',
    isAvailable: true,
  },
  {
    id: 'invoice-default',
    type: 'invoice',
    entityTypeId: 31,
    categoryId: null,
    title: 'РЎС‡РµС‚Р°',
    sourceLabel: 'РЎС‡РµС‚Р°',
    isAvailable: true,
  },
];

const normalizeDealCategory = (category: BitrixDealCategory): CrmSource => {
  const id = Number(category.ID ?? category.id ?? 0);
  const rawTitle = category.NAME ?? category.name ?? (id === 0 ? 'РџСЂРѕРґР°Р¶Рё' : `Р’РѕСЂРѕРЅРєР° ${id}`);
  const title = rawTitle.toLowerCase().includes('РІРѕСЂРѕРЅРєР°')
    ? rawTitle
    : `Р’РѕСЂРѕРЅРєР° СЃРґРµР»РєРё: ${rawTitle}`;

  return {
    id: `deal-${id}`,
    type: 'deal',
    entityTypeId: 2,
    categoryId: id,
    title,
    sourceLabel: title,
    isAvailable: true,
  };
};

const normalizeInvoiceCategory = (category: BitrixSmartProcessCategory): CrmSource => {
  const categoryId = Number(category.id ?? 0);
  const rawTitle = category.name ?? 'РЎС‡РµС‚Р°';
  const title = rawTitle === 'РЎС‡РµС‚Р°' ? rawTitle : `РЎС‡РµС‚Р°: ${rawTitle}`;

  return {
    id: `invoice-${categoryId}`,
    type: 'invoice',
    entityTypeId: 31,
    categoryId,
    title,
    sourceLabel: title,
    isAvailable: true,
  };
};

const normalizeSmartProcessCategory = (
  type: BitrixSmartProcessType,
  category: BitrixSmartProcessCategory,
): CrmSource => {
  const entityTypeId = Number(type.entityTypeId ?? category.entityTypeId);
  const categoryId = Number(category.id ?? 0);
  const typeTitle = type.title ?? type.name ?? `РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ ${entityTypeId}`;
  const categoryTitle = category.name ?? 'РћСЃРЅРѕРІРЅРѕРµ РЅР°РїСЂР°РІР»РµРЅРёРµ';
  const title = `${typeTitle}: ${categoryTitle}`;

  return {
    id: `smart-${entityTypeId}-${categoryId}`,
    type: 'smartProcess',
    entityTypeId,
    categoryId,
    title,
    sourceLabel: title,
    isAvailable: true,
  };
};

const loadLeadStages = async (): Promise<BitrixStatus[]> =>
  toArray<BitrixStatus>(
    await callBitrixMethod('crm.status.list', {
      filter: { ENTITY_ID: 'STATUS' },
    }),
  );

const getDealStageEntityId = (categoryId: number | null | undefined) =>
  categoryId && categoryId > 0 ? `DEAL_STAGE_${categoryId}` : 'DEAL_STAGE';

const loadDealStages = async (categoryId: number | null | undefined): Promise<BitrixStatus[]> =>
  toArray<BitrixStatus>(
    await callBitrixMethod('crm.status.list', {
      filter: { ENTITY_ID: getDealStageEntityId(categoryId) },
    }),
  );

const getSmartProcessStageEntityId = (
  _entityTypeId: number,
  _categoryId: number | null | undefined,
) => {
  // TODO: РїСЂРѕРІРµСЂРёС‚СЊ РЅР° СЂРµР°Р»СЊРЅРѕРј РїРѕСЂС‚Р°Р»Рµ Р‘РёС‚СЂРёРєСЃ24 С„РѕСЂРјР°С‚ ENTITY_ID СЃС‚Р°РґРёР№ СЃРјР°СЂС‚-РїСЂРѕС†РµСЃСЃРѕРІ.
  return null;
};

const loadSmartProcessStages = async (
  entityTypeId: number,
  categoryId: number | null | undefined,
): Promise<BitrixStatus[]> => {
  const entityId = getSmartProcessStageEntityId(entityTypeId, categoryId);

  if (!entityId) {
    return [];
  }

  return toArray<BitrixStatus>(
    await callBitrixMethod('crm.status.list', {
      filter: { ENTITY_ID: entityId },
    }),
  );
};

const loadInvoiceSources = async (): Promise<CrmSource[]> => {
  try {
    const categoriesResponse = await callBitrixMethod('crm.category.list', { entityTypeId: 31 });
    const categories = toArray<BitrixSmartProcessCategory>(categoriesResponse);

    if (categories.length) {
      return categories.map(normalizeInvoiceCategory);
    }
  } catch (error) {
    console.warn('[Bitrix data source] invoice categories were not loaded', error);
  }

  return [
    {
      id: 'invoice-default',
      type: 'invoice',
      entityTypeId: 31,
      categoryId: null,
      title: 'РЎС‡РµС‚Р°',
      sourceLabel: 'РЎС‡РµС‚Р°',
      isAvailable: true,
    },
  ];
};

export const bitrixReportDataSource: ReportDataSource = {
  async loadCrmSources() {
    const sources: CrmSource[] = [
      {
        id: 'lead-default',
        type: 'lead',
        entityTypeId: 1,
        categoryId: null,
        title: 'Р’РѕСЂРѕРЅРєР° Р»РёРґРѕРІ',
        sourceLabel: 'Р›РёРґС‹',
        isAvailable: true,
      },
    ];

    try {
      const dealCategoriesResponse = await callBitrixMethod('crm.category.list', { entityTypeId: 2 });
      const dealCategories = toArray<BitrixDealCategory>(dealCategoriesResponse);

      if (dealCategories.length) {
        sources.push(...dealCategories.map(normalizeDealCategory));
      } else {
        sources.push(normalizeDealCategory({ id: 0, name: 'РџСЂРѕРґР°Р¶Рё' }));
      }
    } catch (error) {
      console.warn('[Bitrix data source] deal categories were not loaded', error);
    }

    try {
      const smartTypesResponse = await callBitrixMethod('crm.type.list', {});
      const smartTypes = toArray<BitrixSmartProcessType>(smartTypesResponse);

      for (const type of smartTypes) {
        const entityTypeId = Number(type.entityTypeId);

        if (!Number.isFinite(entityTypeId)) {
          continue;
        }

        const categoriesResponse = await callBitrixMethod('crm.category.list', { entityTypeId });
        const categories = toArray<BitrixSmartProcessCategory>(categoriesResponse);

        if (!categories.length) {
          sources.push({
            id: `smart-${entityTypeId}-0`,
            type: 'smartProcess',
            entityTypeId,
            categoryId: 0,
            title: type.title ?? type.name ?? `РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ ${entityTypeId}`,
            sourceLabel: type.title ?? type.name ?? `РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ ${entityTypeId}`,
            isAvailable: true,
          });
          continue;
        }

        sources.push(...categories.map((category) => normalizeSmartProcessCategory(type, category)));
      }
    } catch (error) {
      console.warn('[Bitrix data source] smart processes were not loaded', error);
    }

    sources.push(...(await loadInvoiceSources()));

    try {
      await Promise.allSettled([
        loadLeadStages(),
        ...sources
          .filter((source) => source.type === 'deal')
          .map((source) => loadDealStages(source.categoryId)),
        ...sources
          .filter((source) => source.type === 'smartProcess' && source.entityTypeId)
          .map((source) => loadSmartProcessStages(source.entityTypeId as number, source.categoryId)),
      ]);
    } catch (error) {
      console.warn('[Bitrix data source] stages were not loaded', error);
    }

    return sources;
  },

  async loadPeriods() {
    return periodOptions;
  },

  async loadMetricSections() {
    return metricSections;
  },

  async loadMetrics() {
    return metrics;
  },

  async loadReportData(_filters: ReportLoadFilters): Promise<ReportPoint[]> {
    // Mock-РґР°РЅРЅС‹Рµ РІ СЂР°Р±РѕС‡РµРј Bitrix/backend-СЂРµР¶РёРјРµ Р±РѕР»СЊС€Рµ РЅРµ РІРѕР·РІСЂР°С‰Р°РµРј.
    // Р РµР°Р»СЊРЅС‹Р№ СЂР°СЃС‡РµС‚ РїРѕРґРєР»СЋС‡РёРј РїРѕСЃР»Рµ backend API report session.
    return [];
  },

  async loadMetricDetails(_request: MetricDetailsRequest): Promise<MetricDetailItem[]> {
    // Р”РµС‚Р°Р»РёР·Р°С†РёСЏ Р±СѓРґРµС‚ РїРѕРґРєР»СЋС‡РµРЅР° Рє backend API.
    return [];
  },

  async loadEmployeesMetric(_request: EmployeeMetricRequest): Promise<EmployeeMetricItem[]> {
    // Р Р°Р·Р±РёРІРєР° РїРѕ СЃРѕС‚СЂСѓРґРЅРёРєР°Рј Р±СѓРґРµС‚ РїРѕРґРєР»СЋС‡РµРЅР° Рє backend API.
    return [];
  },

  getInitialCrmSources() {
    return defaultCrmSources;
  },

  getInitialReportData(_filters: ReportLoadFilters): ReportPoint[] {
    return [];
  },
};

