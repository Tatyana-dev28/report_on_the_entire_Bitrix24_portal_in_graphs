import { useEffect, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import {
  REPORT_ONBOARDING_STEPS,
  type ReportOnboardingStep,
} from '../utils/reportOnboarding';
import './ReportOnboarding.css';

type ReportOnboardingProps = {
  open: boolean;
  stepIndex: number;
  onStepChange: (index: number) => void;
  onClose: () => void;
  /** Root of the report UI used to find highlight targets. */
  rootSelector?: string;
};

export default function ReportOnboarding({
  open,
  stepIndex,
  onStepChange,
  onClose,
  rootSelector = '.report-card',
}: ReportOnboardingProps) {
  const [highlightStyle, setHighlightStyle] = useState<CSSProperties | null>(null);
  const step: ReportOnboardingStep | undefined = REPORT_ONBOARDING_STEPS[stepIndex];
  const total = REPORT_ONBOARDING_STEPS.length;
  const isLast = stepIndex >= total - 1;

  useEffect(() => {
    if (!open || !step) {
      setHighlightStyle(null);
      return undefined;
    }

    const updateHighlight = () => {
      const root = document.querySelector(rootSelector);
      if (!root) {
        setHighlightStyle(null);
        return;
      }

      const target = root.querySelector(step.highlightSelector) as HTMLElement | null;
      if (!target) {
        setHighlightStyle(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      const pad = 8;
      setHighlightStyle({
        top: Math.max(8, rect.top - pad),
        left: Math.max(8, rect.left - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      });
    };

    updateHighlight();
    window.addEventListener('resize', updateHighlight);
    window.addEventListener('scroll', updateHighlight, true);
    const intervalId = window.setInterval(updateHighlight, 500);

    return () => {
      window.removeEventListener('resize', updateHighlight);
      window.removeEventListener('scroll', updateHighlight, true);
      window.clearInterval(intervalId);
    };
  }, [open, rootSelector, step, stepIndex]);

  if (!open || !step) {
    return null;
  }

  return (
    <div className="report-onboarding" role="dialog" aria-modal="false" aria-label="Как читать отчёт">
      {highlightStyle && (
        <div className="report-onboarding-highlight" style={highlightStyle} aria-hidden="true" />
      )}

      <div className="report-onboarding-card">
        <div className="report-onboarding-card-head">
          <span className="report-onboarding-progress">
            Подсказка {stepIndex + 1} из {total}
          </span>
          <button
            className="icon-button report-onboarding-close"
            type="button"
            aria-label="Закрыть подсказки"
            title="Закрыть подсказки"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <p className="report-onboarding-title">{step.title}</p>
        <p className="report-onboarding-body">{step.body}</p>
        <div className="report-onboarding-actions">
          <button className="report-onboarding-skip" type="button" onClick={onClose}>
            Закрыть
          </button>
          {!isLast ? (
            <button
              className="report-onboarding-next"
              type="button"
              onClick={() => onStepChange(stepIndex + 1)}
            >
              Далее
            </button>
          ) : (
            <button className="report-onboarding-next" type="button" onClick={onClose}>
              Понятно
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
