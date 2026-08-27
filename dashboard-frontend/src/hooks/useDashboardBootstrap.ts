import { useEffect, useState } from 'react';
import { loadOwnerDashboardBootstrap } from '../api/dashboardApi';
import type { OwnerDashboardBootstrap } from '../api/types';

type BootstrapState = {
  data: OwnerDashboardBootstrap | null;
  loading: boolean;
  error: string;
};

export function useDashboardBootstrap() {
  const [state, setState] = useState<BootstrapState>({
    data: null,
    loading: true,
    error: '',
  });

  useEffect(() => {
    let active = true;

    loadOwnerDashboardBootstrap()
      .then((data) => {
        if (!active) {
          return;
        }

        setState({ data, loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Не удалось открыть WEB-дашборд.',
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
