import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardAccessGate } from './components/access/DashboardAccessGate';
import '../../frontend/src/styles.css';
import './styles/dashboard.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DashboardAccessGate />
  </React.StrictMode>,
);
