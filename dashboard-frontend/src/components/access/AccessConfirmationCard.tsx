type AccessConfirmationCardProps = {
  onTrustDevice: () => void;
  onUseTemporaryAccess: () => void;
  busy: boolean;
  notice: string;
  error?: string;
};

export function AccessConfirmationCard({
  onTrustDevice,
  onUseTemporaryAccess,
  busy,
  notice,
  error,
}: AccessConfirmationCardProps) {
  return (
    <section className="dashboard-access-card" aria-labelledby="dashboard-access-title">
      <div>
        <p className="dashboard-eyebrow">Подтверждение входа</p>
        <h2 id="dashboard-access-title">Запомнить доступ на этом устройстве?</h2>
        <span>
          Личность уже подтверждена ссылкой из приложения Битрикс24. Выберите, сохранить ли вход
          на этом компьютере.
        </span>
      </div>
      <div className="dashboard-access-actions">
        <button className="dashboard-primary-button" type="button" onClick={onTrustDevice} disabled={busy}>
          Да, это мой компьютер
        </button>
        <button className="dashboard-secondary-button" type="button" onClick={onUseTemporaryAccess} disabled={busy}>
          Нет, это чужой компьютер
        </button>
      </div>
      {notice ? <p className="dashboard-access-notice">{notice}</p> : null}
      {error ? <p className="dashboard-access-notice">{error}</p> : null}
    </section>
  );
}
