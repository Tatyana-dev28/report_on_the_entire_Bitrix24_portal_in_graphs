export type DashboardAccessState = 'checking' | 'authorized' | 'needs_confirmation' | 'denied';

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
  access: DashboardAccessState;
  portal: {
    domain: string;
    memberId: string;
  } | null;
  reports: DashboardSavedReport[];
  selectedReportId: string | null;
  refreshStatus: DashboardRefreshStatus | null;
};
