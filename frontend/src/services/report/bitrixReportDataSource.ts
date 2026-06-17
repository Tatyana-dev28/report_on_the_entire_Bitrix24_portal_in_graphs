import { callBitrixMethod } from '../bitrix/bitrixClient';
import type {
  BitrixDealCategory,
  BitrixSmartProcessCategory,
  BitrixSmartProcessType,
  BitrixStatus,
} from '../bitrix/bitrixTypes';
import { mockReportDataSource } from './mockReportDataSource';
import type {
  CrmSource,
  EmployeeMetricItem,
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

const normalizeDealCategory = (category: BitrixDealCategory): CrmSource => {
  const id = Number(category.ID ?? category.id ?? 0);
  const rawTitle = category.NAME ?? category.name ?? (id === 0 ? 'Продажи' : `Воронка ${id}`);
  const title = rawTitle.toLowerCase().includes('воронка')
    ? rawTitle
    : `Воронка сделки: ${rawTitle}`;

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
  const rawTitle = category.name ?? 'Счета';
  const title = rawTitle === 'Счета' ? rawTitle : `Счета: ${rawTitle}`;

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
  const typeTitle = type.title ?? type.name ?? `Смарт-процесс ${entityTypeId}`;
  const categoryTitle = category.name ?? 'Основное направление';
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
  // TODO: проверить на реальном портале Битрикс24 формат ENTITY_ID стадий смарт-процессов.
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
    // Заготовка: если направления счетов доступны через crm.category.list, используем их.
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
      title: 'Счета',
      sourceLabel: 'Счета',
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
        title: 'Воронка лидов',
        sourceLabel: 'Лиды',
        isAvailable: true,
      },
    ];

    try {
      // Реальная загрузка всех воронок сделок портала.
      const dealCategoriesResponse = await callBitrixMethod('crm.category.list', { entityTypeId: 2 });
      const dealCategories = toArray<BitrixDealCategory>(dealCategoriesResponse);

      if (dealCategories.length) {
        sources.push(...dealCategories.map(normalizeDealCategory));
      } else {
        sources.push(normalizeDealCategory({ id: 0, name: 'Продажи' }));
      }
    } catch (error) {
      console.warn('[Bitrix data source] deal categories were not loaded', error);
    }

    try {
      // Здесь будет загрузка смарт-процессов портала.
      // TODO: проверить на реальном портале Битрикс24, что crm.type.list возвращает все нужные типы.
      const smartTypesResponse = await callBitrixMethod('crm.type.list', {});
      const smartTypes = toArray<BitrixSmartProcessType>(smartTypesResponse);

      for (const type of smartTypes) {
        const entityTypeId = Number(type.entityTypeId);

        if (!Number.isFinite(entityTypeId)) {
          continue;
        }

        // Здесь будет загрузка направлений/воронок каждого смарт-процесса.
        const categoriesResponse = await callBitrixMethod('crm.category.list', { entityTypeId });
        const categories = toArray<BitrixSmartProcessCategory>(categoriesResponse);

        if (!categories.length) {
          sources.push({
            id: `smart-${entityTypeId}-0`,
            type: 'smartProcess',
            entityTypeId,
            categoryId: 0,
            title: type.title ?? type.name ?? `Смарт-процесс ${entityTypeId}`,
            sourceLabel: type.title ?? type.name ?? `Смарт-процесс ${entityTypeId}`,
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
      // Заготовки стадий уже готовы для будущего расчета показателей.
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

    if (sources.length > 1) {
      return sources;
    }

    console.warn('[Bitrix data source] CRM sources fallback to mock data');
    return mockReportDataSource.loadCrmSources();
  },

  async loadPeriods() {
    return mockReportDataSource.loadPeriods();
  },

  async loadMetricSections() {
    return mockReportDataSource.loadMetricSections();
  },

  async loadMetrics() {
    return mockReportDataSource.loadMetrics();
  },

  async loadReportData(filters: ReportLoadFilters) {
    try {
      // Здесь будет загрузка лидов, сделок, счетов и смарт-процессов по фильтрам отчета.
      // Здесь будет расчет показателей главного графика и строк таблицы.
      await callBitrixMethod('crm.deal.list', {
        select: ['ID', 'TITLE', 'OPPORTUNITY', 'DATE_CREATE', 'ASSIGNED_BY_ID'],
        filter: {},
        start: 0,
      });
    } catch (error) {
      console.warn('[Bitrix data source] report data fallback to mock data', error);
    }

    return mockReportDataSource.loadReportData(filters);
  },

  async loadMetricDetails(_request: MetricDetailsRequest): Promise<MetricDetailItem[]> {
    try {
      // Здесь будет детализация сущностей Битрикс24 по клику на значение показателя.
      await callBitrixMethod('crm.activity.list', { select: ['ID'], filter: {}, start: 0 });
    } catch (error) {
      console.warn('[Bitrix data source] metric details are not implemented yet', error);
    }

    return [];
  },

  async loadEmployeesMetric(_request: MetricDetailsRequest): Promise<EmployeeMetricItem[]> {
    try {
      // Здесь будет загрузка сотрудников, значений по ним и аватарок.
      await callBitrixMethod('user.get', { filter: { ACTIVE: true } });
    } catch (error) {
      console.warn('[Bitrix data source] employee metrics are not implemented yet', error);
    }

    return [];
  },

  getInitialCrmSources() {
    return mockReportDataSource.getInitialCrmSources();
  },

  getInitialReportData(filters: ReportLoadFilters) {
    return mockReportDataSource.getInitialReportData(filters);
  },
};
