import { isBitrixAvailable } from '../bitrix/bitrixClient';
import { bitrixReportDataSource } from './bitrixReportDataSource';
import { mockReportDataSource } from './mockReportDataSource';
import type { ReportDataSource } from './reportTypes';

export const reportDataSource: ReportDataSource = isBitrixAvailable()
  ? bitrixReportDataSource
  : mockReportDataSource;

export type { ReportDataSource };
