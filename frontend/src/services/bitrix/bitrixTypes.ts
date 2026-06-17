export type BitrixMethodParams = Record<string, unknown>;

export type BitrixMethodResult<T> = {
  data: () => T;
  error?: () => string | null;
  error_description?: () => string | null;
};

export type BitrixApi = {
  callMethod: <T = unknown>(
    method: string,
    params: BitrixMethodParams,
    callback: (result: BitrixMethodResult<T>) => void,
  ) => void;
  callBatch?: (
    calls: Record<string, [string, BitrixMethodParams]>,
    callback: (result: Record<string, BitrixMethodResult<unknown>>) => void,
  ) => void;
};

export type BitrixDealCategory = {
  ID?: string | number;
  id?: string | number;
  NAME?: string;
  name?: string;
};

export type BitrixSmartProcessType = {
  entityTypeId?: number;
  title?: string;
  name?: string;
  isCategoriesEnabled?: boolean;
};

export type BitrixSmartProcessCategory = {
  id?: number;
  entityTypeId?: number;
  name?: string;
};

export type BitrixStatus = {
  ID?: string | number;
  ENTITY_ID?: string;
  STATUS_ID?: string;
  NAME?: string;
  SORT?: number;
};

declare global {
  interface Window {
    BX24?: BitrixApi;
  }
}

export {};
