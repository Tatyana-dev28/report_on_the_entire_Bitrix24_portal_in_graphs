import {
  APP_SETTINGS_STORAGE_KEY,
  DETAIL_COLUMN_STORAGE_KEY,
  SAVED_VIEWS_STORAGE_KEY,
  defaultAppSettings,
  defaultDetailColumnWidths,
  defaultSavedView,
} from './constants';
import type { AppSettings, DetailColumnKey, SavedReportViewOption } from './types';
import { sanitizeDetailColumnWidths } from './utils/detailColumns';

export const loadSavedViews = (): SavedReportViewOption[] => {
  if (typeof window === 'undefined') {
    return [defaultSavedView];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);

    if (!raw) {
      return [defaultSavedView];
    }

    const savedViews = JSON.parse(raw) as SavedReportViewOption[];
    const userViews = Array.isArray(savedViews)
      ? savedViews.filter((view) => view.value !== defaultSavedView.value)
      : [];

    return [defaultSavedView, ...userViews];
  } catch {
    return [defaultSavedView];
  }
};

export const persistSavedViews = (views: SavedReportViewOption[]) => {
  window.localStorage.setItem(
    SAVED_VIEWS_STORAGE_KEY,
    JSON.stringify(views.filter((view) => !view.isSystem)),
  );
};

export const loadAppSettings = (): AppSettings => {
  if (typeof window === 'undefined') {
    return defaultAppSettings;
  }

  try {
    return {
      ...defaultAppSettings,
      ...(JSON.parse(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<AppSettings>),
    };
  } catch {
    return defaultAppSettings;
  }
};

export const loadDetailColumnWidths = () => {
  if (typeof window === 'undefined') {
    return defaultDetailColumnWidths;
  }

  try {
    const raw = window.localStorage.getItem(DETAIL_COLUMN_STORAGE_KEY);

    if (!raw) {
      return defaultDetailColumnWidths;
    }

    return sanitizeDetailColumnWidths(JSON.parse(raw) as Partial<Record<DetailColumnKey, number>>);
  } catch {
    return defaultDetailColumnWidths;
  }
};
