import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardErrorBoundary } from './components/DashboardErrorBoundary';
import { DashboardAccessGate } from './components/access/DashboardAccessGate';
import '../../frontend/src/styles.css';
import './styles/dashboard.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <DashboardAccessGate />
    </DashboardErrorBoundary>
  </React.StrictMode>,
);
