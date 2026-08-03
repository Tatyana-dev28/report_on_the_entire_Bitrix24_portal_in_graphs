const ONBOARDING_STORAGE_KEY = 'sapp24-report-onboarding-v1';

export type ReportOnboardingStepId = 'main' | 'corridor' | 'click';

export type ReportOnboardingStep = {
  id: ReportOnboardingStepId;
  title: string;
  body: string;
  /** CSS selector within .report-card for a light highlight ring (optional). */
  highlightSelector: string;
};

export const REPORT_ONBOARDING_STEPS: ReportOnboardingStep[] = [
  {
    id: 'main',
    title: 'Главный показатель',
    body: 'Это ключевая линия отчёта. Настройте источники и режим (деньги или количество), затем постройте отчёт — график покажет динамику за период.',
    highlightSelector: '.chart-left .section-title-row',
  },
  {
    id: 'corridor',
    title: 'Коридор и цвета',
    body: 'Верхняя и нижняя границы задают коридор нормы. Цвет появляется только при выходе за границу и зависит от направления показателя («больше — лучше» или «меньше — лучше»).',
    highlightSelector: '.chart-wrap, .main-indicator-empty',
  },
  {
    id: 'click',
    title: 'Клик по числу',
    body: 'Кликните по любому числу, чтобы увидеть звонки, лиды или сделки, из которых оно сформировано.',
    highlightSelector: '.report-table',
  },
];

export const isReportOnboardingCompleted = () => {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
};

export const markReportOnboardingCompleted = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'done');
  } catch {
    // ignore quota / private mode
  }
};

export const clearReportOnboardingCompleted = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export { ONBOARDING_STORAGE_KEY };
