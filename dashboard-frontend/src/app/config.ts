export const dashboardConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '',
  dashboardBaseUrl: import.meta.env.VITE_DASHBOARD_BASE_URL?.replace(/\/+$/, '') ?? '',
};
