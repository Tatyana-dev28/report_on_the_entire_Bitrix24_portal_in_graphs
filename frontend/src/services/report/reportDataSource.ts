import { bitrixReportDataSource } from './bitrixReportDataSource';
import { dashboardReportDataSource } from './dashboardReportDataSource';
import { mockReportDataSource } from './mockReportDataSource';
import type { ReportDataSource } from './reportTypes';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';
const appMode = import.meta.env.VITE_APP_MODE;

export const reportDataSource: ReportDataSource = useMockData
  ? mockReportDataSource
  : appMode === 'dashboard'
    ? dashboardReportDataSource
    : bitrixReportDataSource;

export type { ReportDataSource };
