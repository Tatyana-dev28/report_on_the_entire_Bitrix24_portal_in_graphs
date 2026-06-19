import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { SelectOption } from '../types';

export function useOutsideClose<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  extraRefs: Array<RefObject<HTMLElement | null>> = [],
) {
  const ref = useRef<T>(null);
  const extraRefsRef = useRef(extraRefs);

  extraRefsRef.current = extraRefs;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const clickedInsideMain = ref.current?.contains(target);
      const clickedInsideExtra = extraRefsRef.current.some((extraRef) =>
        extraRef.current?.contains(target),
      );
      const clickedInsideFloatingPopover =
        target instanceof Element && Boolean(target.closest('.floating-popover'));

      if (!clickedInsideMain && !clickedInsideExtra && !clickedInsideFloatingPopover) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, onClose]);

  return ref;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function useBoundedPopoverPosition<T extends HTMLElement>(
  ref: RefObject<T | null>,
  open: boolean,
  expectedWidth: number,
  expectedHeight: number,
) {
  const [style, setStyle] = useState<CSSProperties>({ width: expectedWidth });

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const update = () => {
      const shell = ref.current;

      if (!shell) {
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const appRect = shell.closest('.report-card')?.getBoundingClientRect();
      const boundary = appRect ?? {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
        width: window.innerWidth,
      };
      const gap = 8;
      const padding = 12;
      const width = Math.min(expectedWidth, Math.max(180, boundary.width - padding * 2));
      const minLeft = boundary.left + padding - shellRect.left;
      const maxLeft = boundary.right - padding - shellRect.left - width;
      const preferredLeft = shellRect.width - width;
      const minTop = boundary.top + padding - shellRect.top;
      const maxTop = boundary.bottom - padding - shellRect.top - expectedHeight;
      const preferredTop =
        shellRect.bottom + gap + expectedHeight <= boundary.bottom - padding
          ? shellRect.height + gap
          : -expectedHeight - gap;

      setStyle({
        width,
        left: maxLeft < minLeft ? minLeft : clamp(preferredLeft, minLeft, maxLeft),
        top: maxTop < minTop ? minTop : clamp(preferredTop, minTop, maxTop),
      });
    };

    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
    };
  }, [expectedHeight, expectedWidth, open, ref]);

  return style;
}

export function FloatingPopover({
  anchorRef,
  popoverRef,
  open,
  className,
  expectedWidth,
  expectedHeight,
  children,
  role,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  className: string;
  expectedWidth: number;
  expectedHeight: number;
  children: ReactNode;
  role?: string;
}) {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    width: expectedWidth,
    left: 0,
    top: 0,
    visibility: 'hidden',
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const anchor = anchorRef.current;

    if (!anchor) {
      return undefined;
    }

    const app = anchor.closest('.report-card') as HTMLElement | null;
    const nextLayer = app?.querySelector('.floating-layer') as HTMLElement | null;
    const targetLayer = nextLayer ?? app ?? document.body;
    setLayer(targetLayer);

    let frame = 0;
    const update = () => {
      const currentAnchor = anchorRef.current;

      if (!currentAnchor) {
        return;
      }

      const appElement = currentAnchor.closest('.report-card') as HTMLElement | null;
      const appRect = appElement?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const anchorRect = currentAnchor.getBoundingClientRect();
      const padding = 12;
      const gap = 8;
      const visibleLeft = Math.max(appRect.left, 0);
      const visibleRight = Math.min(appRect.right, window.innerWidth);
      const visibleTop = Math.max(appRect.top, 0);
      const visibleBottom = Math.min(appRect.bottom, window.innerHeight);
      const boundaryWidth = Math.max(180, visibleRight - visibleLeft - padding * 2);
      const desiredWidth = Math.max(expectedWidth, anchorRect.width);
      const width = Math.min(desiredWidth, boundaryWidth);
      const minViewportLeft = visibleLeft + padding;
      const maxViewportLeft = visibleRight - padding - width;
      const preferredViewportLeft = anchorRect.right - width;
      const minViewportTop = visibleTop + padding;
      const maxViewportTop = visibleBottom - padding - expectedHeight;
      const preferredViewportTop =
        anchorRect.bottom + gap + expectedHeight <= visibleBottom - padding
          ? anchorRect.bottom + gap
          : anchorRect.top - expectedHeight - gap;
      const viewportLeft =
        maxViewportLeft < minViewportLeft
          ? minViewportLeft
          : clamp(preferredViewportLeft, minViewportLeft, maxViewportLeft);
      const viewportTop =
        maxViewportTop < minViewportTop
          ? minViewportTop
          : clamp(preferredViewportTop, minViewportTop, maxViewportTop);

      setStyle({
        width,
        left: viewportLeft - appRect.left,
        top: viewportTop - appRect.top,
        visibility: 'visible',
      });
    };

    frame = requestAnimationFrame(update);
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [anchorRef, expectedHeight, expectedWidth, open]);

  if (!open || !layer) {
    return null;
  }

  return createPortal(
    <div
      className={`${className} floating-popover`}
      ref={popoverRef}
      role={role}
      style={style}
    >
      {children}
    </div>,
    layer,
  );
}

export function BrandLogo() {
  const [logoAvailable, setLogoAvailable] = useState(true);

  return (
    <a
      className="brand-mark"
      href="https://sapp24.com/?utm_source=app-b24"
      target="_blank"
      rel="noreferrer"
      aria-label="РћС‚РєСЂС‹С‚СЊ СЃР°Р№С‚ РЎРђРџРџ"
    >
      {logoAvailable && (
        <img
          src="/sapp-logo.svg"
          alt="РЎРђРџРџ"
          onError={() => setLogoAvailable(false)}
        />
      )}
      {!logoAvailable && <span>РЎРђРџРџ</span>}
    </a>
  );
}

export function TooltipPortal({
  label,
  style,
}: {
  label: string;
  style: CSSProperties;
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <span className="tooltip-bubble" style={style}>
      {label}
    </span>,
    document.body,
  );
}

export function TooltipButton({
  label,
  children,
  className = '',
  onClick,
  ariaPressed,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
  ariaPressed?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const appRect = button.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(120, Math.min(260, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(148, label.length * 6.8 + 24));
    const estimatedLines = Math.max(1, Math.ceil((label.length * 6.8) / Math.max(80, estimatedWidth - 24)));
    const estimatedHeight = Math.max(36, estimatedLines * 17 + 18);
    const left = Math.min(
      Math.max(buttonRect.left + buttonRect.width / 2 - estimatedWidth / 2, boundary.left + 12),
      boundary.right - estimatedWidth - 12,
    );
    const hasTopSpace = buttonRect.top - boundary.top > estimatedHeight + 12;
    const preferredTop = hasTopSpace ? buttonRect.top - 10 : buttonRect.bottom + 10;
    const top = Math.min(
      Math.max(preferredTop, boundary.top + 12),
      boundary.bottom - estimatedHeight - 12,
    );

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: hasTopSpace && top === preferredTop ? 'translateY(-100%)' : 'translateY(0)',
    });
  };

  return (
    <button
      className={`icon-button tooltip-host ${className}`}
      type="button"
      onClick={onClick}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      aria-label={label}
      aria-pressed={ariaPressed}
      ref={buttonRef}
    >
      {children}
      {tooltipStyle && (
        <TooltipPortal label={label} style={tooltipStyle} />
      )}
    </button>
  );
}

export function TooltipLink({
  label,
  href,
  children,
  className = '',
}: {
  label: string;
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const link = linkRef.current;

    if (!link) {
      return;
    }

    const linkRect = link.getBoundingClientRect();
    const appRect = link.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(120, Math.min(260, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(148, label.length * 6.8 + 24));
    const estimatedLines = Math.max(1, Math.ceil((label.length * 6.8) / Math.max(80, estimatedWidth - 24)));
    const estimatedHeight = Math.max(36, estimatedLines * 17 + 18);
    const left = Math.min(
      Math.max(linkRect.left + linkRect.width / 2 - estimatedWidth / 2, boundary.left + 12),
      boundary.right - estimatedWidth - 12,
    );
    const hasTopSpace = linkRect.top - boundary.top > estimatedHeight + 12;
    const preferredTop = hasTopSpace ? linkRect.top - 10 : linkRect.bottom + 10;
    const top = Math.min(
      Math.max(preferredTop, boundary.top + 12),
      boundary.bottom - estimatedHeight - 12,
    );

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: hasTopSpace && top === preferredTop ? 'translateY(-100%)' : 'translateY(0)',
    });
  };

  return (
    <a
      className={`icon-button tooltip-host ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      ref={linkRef}
    >
      {children}
      {tooltipStyle && (
        <TooltipPortal label={label} style={tooltipStyle} />
      )}
    </a>
  );
}

export function ValueCellButton({
  className = '',
  valueLabel,
  onClick,
}: {
  className?: string;
  valueLabel: string;
  onClick: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const appRect = button.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(120, Math.min(280, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(112, valueLabel.length * 7 + 24));
    const estimatedHeight = 36;
    const left = Math.min(
      Math.max(buttonRect.left + buttonRect.width / 2, boundary.left + estimatedWidth / 2 + 12),
      boundary.right - estimatedWidth / 2 - 12,
    );
    const preferredTop = buttonRect.top - 10;
    const top = Math.min(
      Math.max(preferredTop, boundary.top + estimatedHeight + 12),
      boundary.bottom - 12,
    );

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: 'translate(-50%, -100%)',
    });
  };

  return (
    <button
      className={`value-cell value-cell-button ${className}`.trim()}
      type="button"
      onClick={onClick}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      ref={buttonRef}
    >
      <span className="value-cell-badge">{valueLabel}</span>
      <span className="value-cell-corner-arrow" aria-hidden="true">
        в†—
      </span>
      {tooltipStyle && <TooltipPortal label={valueLabel} style={tooltipStyle} />}
    </button>
  );
}

export function CustomSelect<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={`select-shell ${className} ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="select-menu"
          expectedWidth={220}
          expectedHeight={280}
          role="listbox"
        >
          {options.map((option) => (
            <button
              className="select-option"
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </FloatingPopover>
      )}
    </div>
  );
}


