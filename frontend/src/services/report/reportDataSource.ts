import { bitrixReportDataSource } from './bitrixReportDataSource';
import { mockReportDataSource } from './mockReportDataSource';
import type { ReportDataSource } from './reportTypes';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export const reportDataSource: ReportDataSource = useMockData
  ? mockReportDataSource
  : bitrixReportDataSource;

export type { ReportDataSource };
