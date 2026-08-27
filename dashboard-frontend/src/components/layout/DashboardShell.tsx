import type { ReactNode } from 'react';

type DashboardShellProps = {
  children: ReactNode;
};

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">{children}</section>
    </main>
  );
}
