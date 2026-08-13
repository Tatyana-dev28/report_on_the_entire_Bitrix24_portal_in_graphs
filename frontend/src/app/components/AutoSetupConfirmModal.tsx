import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useOutsideClose } from './common';

const AUTO_SETUP_ACTIONS = [
  'Установит период — последние 7 дней',
  'Выберет главным показателем воронку Bitrix24 с ID00',
  'Добавит доступные показатели',
  'Автоматически рассчитает коридоры',
  'Включит подсветку отклонений',
  'Скроет нулевые показатели',
] as const;

export default function AutoSetupConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (suppressPrompt: boolean) => void;
}) {
  const [suppressPrompt, setSuppressPrompt] = useState(false);
  const panelRef = useOutsideClose<HTMLDivElement>(true, onCancel);

  return (
    <div className="modal-layer" role="presentation">
      <div
        className="modal-panel auto-setup-confirm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-setup-confirm-title"
        ref={panelRef}
      >
        <div className="modal-head">
          <p id="auto-setup-confirm-title">Настроить показатели автоматически?</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="auto-setup-confirm-lead">Система выполнит следующие действия:</p>
        <ul className="auto-setup-confirm-list">
          {AUTO_SETUP_ACTIONS.map((item) => (
            <li key={item}>
              <Check size={16} aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <label className="auto-setup-confirm-suppress">
          <input
            type="checkbox"
            checked={suppressPrompt}
            onChange={(event) => setSuppressPrompt(event.target.checked)}
          />
          <span>Больше не показывать эту подсказку</span>
        </label>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => onConfirm(suppressPrompt)}
          >
            Показать
          </button>
        </div>
      </div>
    </div>
  );
}
