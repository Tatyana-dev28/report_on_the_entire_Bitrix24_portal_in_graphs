export type DashboardAccessState = 'checking' | 'authorized' | 'needs_confirmation' | 'denied';

export type DashboardAccessConfirmResponse = {
  ok: boolean;
  access: 'authorized';
  session: {
    id: string;
    trusted: boolean;
    fingerprint: string;
  };
};

export type DashboardRefreshStatus = {
  lastSuccessfulUpdateAt: string | null;
  nextUpdateAt: string | null;
  isRefreshing: boolean;
  lastAttemptFailedAt: string | null;
  lastErrorMessage: string;
};

export type DashboardSavedReport = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type OwnerDashboardBootstrap = {
  ok: boolean;
  access: DashboardAccessState;
  portal: {
    domain: string;
    memberId: string;
  } | null;
  reports: DashboardSavedReport[];
  selectedReportId: string | null;
  refreshStatus: DashboardRefreshStatus | null;
  refreshPolicy: {
    defaultIntervalMinutes: 10 | 30 | 60;
    allowedIntervalMinutes: Array<10 | 30 | 60>;
    refreshRunRetentionDays: number;
    successfulSnapshotLimit: number;
    shareLinksMode: 'view_only';
  };
};
