import { useEffect, useMemo, useState } from 'react';
import App from '../../../frontend/src/App';
import {
  confirmOwnerDashboardAccess,
  loadOwnerDashboardBootstrap,
} from '../../api/dashboardApi';
import {
  openDashboardShareAccess,
  setDashboardViewerMode,
} from '../../../frontend/src/services/api/dashboardReportApiClient';
import { AccessConfirmationCard } from './AccessConfirmationCard';

const PORTAL_DOMAIN_STORAGE_KEY = 'sapp_dashboard_portal_domain';

const readSearchToken = (key: string) => {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get(key)?.trim() || '';
};

const clearSearchParam = (key: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has(key)) {
    return;
  }

  url.searchParams.delete(key);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

const storePortalDomain = (domain: string | null | undefined) => {
  if (!domain) {
    return;
  }

  try {
    window.sessionStorage.setItem(PORTAL_DOMAIN_STORAGE_KEY, domain);
  } catch {
    // ignore storage errors
  }
};

export function DashboardAccessGate() {
  const launchToken = useMemo(() => readSearchToken('launch'), []);
  const shareToken = useMemo(() => readSearchToken('share'), []);
  const [status, setStatus] = useState<
    'checking' | 'authorized' | 'share' | 'needs_device' | 'needs_bitrix' | 'share_denied'
  >('checking');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;

    if (shareToken && !launchToken) {
      setDashboardViewerMode('share');
      openDashboardShareAccess(shareToken)
        .then((data) => {
          if (!active) {
            return;
          }

          storePortalDomain(data.portal?.domain);
          clearSearchParam('share');
          setStatus('share');
        })
        .catch((loadError) => {
          if (!active) {
            return;
          }

          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Ссылка на отчёт недействительна или отключена.',
          );
          setStatus('share_denied');
        });

      return () => {
        active = false;
      };
    }

    setDashboardViewerMode('owner');
    loadOwnerDashboardBootstrap()
      .then((data) => {
        if (!active) {
          return;
        }

        storePortalDomain(data.portal?.domain);

        if (data.access === 'authorized') {
          clearSearchParam('launch');
          setStatus('authorized');
          return;
        }

        setStatus(launchToken ? 'needs_device' : 'needs_bitrix');
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Не удалось открыть WEB-дашборд.',
        );
        setStatus(launchToken ? 'needs_device' : 'needs_bitrix');
      });

    return () => {
      active = false;
    };
  }, [launchToken, shareToken]);

  const confirmAccess = (trusted: boolean) => {
    if (!launchToken) {
      setStatus('needs_bitrix');
      return;
    }

    setBusy(true);
    setNotice('');
    setError('');

    confirmOwnerDashboardAccess(trusted, launchToken)
      .then(() => loadOwnerDashboardBootstrap())
      .then((data) => {
        storePortalDomain(data.portal?.domain);
        clearSearchParam('launch');
        setDashboardViewerMode('owner');
        setNotice(
          trusted
            ? 'Вход сохранён на этом компьютере.'
            : 'Временный вход активен до закрытия браузера.',
        );
        setStatus('authorized');
      })
      .catch((confirmError) => {
        setError(
          confirmError instanceof Error
            ? confirmError.message
            : 'Не удалось подтвердить вход в WEB-дашборд.',
        );
        setStatus('needs_bitrix');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (status === 'authorized' || status === 'share') {
    return <App />;
  }

  return (
    <main className="dashboard-page">
      {status === 'checking' ? <div className="dashboard-state">Проверяем доступ...</div> : null}

      {status === 'needs_device' ? (
        <AccessConfirmationCard
          notice={notice}
          error={error}
          busy={busy}
          onTrustDevice={() => confirmAccess(true)}
          onUseTemporaryAccess={() => confirmAccess(false)}
        />
      ) : null}

      {status === 'needs_bitrix' ? (
        <section className="dashboard-access-card" aria-labelledby="dashboard-open-from-bitrix-title">
          <div>
            <p className="dashboard-eyebrow">Личный WEB-дашборд</p>
            <h2 id="dashboard-open-from-bitrix-title">Откройте дашборд из приложения Битрикс24</h2>
            <span>
              Личная ссылка сама по себе не открывает кабинет. Подтверждение личности выполняется
              кнопкой «Открыть дашборд» в настройках приложения внутри Битрикс24.
            </span>
            {error ? <p className="dashboard-access-notice">{error}</p> : null}
          </div>
        </section>
      ) : null}

      {status === 'share_denied' ? (
        <section className="dashboard-access-card" aria-labelledby="dashboard-share-denied-title">
          <div>
            <p className="dashboard-eyebrow">Расшаренный отчёт</p>
            <h2 id="dashboard-share-denied-title">Ссылка недоступна</h2>
            <span>
              {error || 'Ссылка истекла, отключена или не существует. Попросите владельца прислать новую.'}
            </span>
          </div>
        </section>
      ) : null}
    </main>
  );
}
