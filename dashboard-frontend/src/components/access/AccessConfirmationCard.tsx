type AccessConfirmationCardProps = {
  onTrustDevice: () => void;
  onUseTemporaryAccess: () => void;
  busy: boolean;
  notice: string;
};

export function AccessConfirmationCard({
  onTrustDevice,
  onUseTemporaryAccess,
  busy,
  notice,
}: AccessConfirmationCardProps) {
  return (
    <section className="dashboard-access-card" aria-labelledby="dashboard-access-title">
      <div>
        <p className="dashboard-eyebrow">Подтверждение входа</p>
        <h2 id="dashboard-access-title">Это ваш компьютер?</h2>
        <span>
          Выберите, нужно ли сохранить вход в личный WEB-дашборд на этом устройстве.
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
    </section>
  );
}
