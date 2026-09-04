import { Component, type ErrorInfo, type ReactNode } from 'react';

type DashboardErrorBoundaryProps = {
  children: ReactNode;
};

type DashboardErrorBoundaryState = {
  message: string;
};

export class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  state: DashboardErrorBoundaryState = {
    message: '',
  };

  static getDerivedStateFromError(error: Error): DashboardErrorBoundaryState {
    return {
      message: error.message || 'Не удалось отрисовать WEB-дашборд.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Dashboard] render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.message) {
      return this.props.children;
    }

    return (
      <main className="dashboard-page">
        <section className="dashboard-access-card">
          <p className="dashboard-eyebrow">WEB-дашборд</p>
          <h2>Страница не открылась</h2>
          <span>{this.state.message}</span>
        </section>
      </main>
    );
  }
}
