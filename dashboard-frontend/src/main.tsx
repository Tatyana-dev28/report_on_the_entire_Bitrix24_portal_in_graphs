import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardApp } from './app/DashboardApp';
import './styles/dashboard.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>,
);
