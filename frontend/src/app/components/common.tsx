import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
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
  options: { closeOnPointerDown?: boolean; closeOnScroll?: boolean } = {},
) {
  const ref = useRef<T>(null);
  const extraRefsRef = useRef(extraRefs);
  const closeOnPointerDown = options.closeOnPointerDown ?? true;
  const closeOnScroll = options.closeOnScroll ?? true;

  extraRefsRef.current = extraRefs;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const isInsideKnownElement = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof Node)) {
        return false;
      }

      const insideMain = ref.current?.contains(eventTarget);
      const insideExtra = extraRefsRef.current.some((extraRef) =>
        extraRef.current?.contains(eventTarget),
      );
      const insideFloatingPopover =
        eventTarget instanceof Element && Boolean(eventTarget.closest('.floating-popover'));

      return Boolean(insideMain || insideExtra || insideFloatingPopover);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!isInsideKnownElement(event.target)) {
        onClose();
      }
    };

    const handleScroll = (event: Event) => {
      if (!isInsideKnownElement(event.target)) {
        onClose();
      }
    };

    if (closeOnPointerDown) {
      document.addEventListener('pointerdown', handlePointerDown);
    }
    if (closeOnScroll) {
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      if (closeOnPointerDown) {
        document.removeEventListener('pointerdown', handlePointerDown);
      }
      if (closeOnScroll) {
        window.removeEventListener('scroll', handleScroll, true);
      }
    };
  }, [closeOnPointerDown, closeOnScroll, open, onClose]);

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
  anchorRect,
  popoverRef,
  open,
  className,
  expectedWidth,
  expectedHeight,
  children,
  role,
  horizontalPlacement = 'left',
  verticalPlacement = 'auto',
  updateOnScroll = true,
  constrainHeight = true,
  offsetLeft = 0,
  pinLeft,
  matchAnchorWidth = true,
  portalToBody = false,
  allowVerticalOverflow = false,
  portalContainer,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  anchorRect?: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'> | null;
  popoverRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  className: string;
  expectedWidth: number;
  expectedHeight: number;
  children: ReactNode;
  role?: string;
  horizontalPlacement?: 'left' | 'right';
  verticalPlacement?: 'auto' | 'anchor-start' | 'below';
  updateOnScroll?: boolean;
  constrainHeight?: boolean;
  /** Extra horizontal shift in px (positive = to the right), applied before viewport clamping. */
  offsetLeft?: number;
  /** Pin left edge to this offset (px) from the report-card left; takes priority over anchor-based left. */
  pinLeft?: number;
  /** When false, keep expectedWidth instead of stretching to the trigger width. */
  matchAnchorWidth?: boolean;
  /** Force fixed viewport coordinates, useful for popovers inside fixed modal overlays. */
  portalToBody?: boolean;
  /** Keep the popover tied to the anchor even when the anchor scrolls out of view. */
  allowVerticalOverflow?: boolean;
  /** Render into a specific positioned container instead of the app/body layer. */
  portalContainer?: HTMLElement | null;
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
    // Outside report-card (e.g. WEB-SET-001 settings panel) portal to body with fixed coords.
    const targetLayer = portalContainer ?? (portalToBody ? document.body : (nextLayer ?? document.body));
    const useFixedLayer = targetLayer === document.body;
    setLayer(targetLayer);

    let frame = 0;
    const update = () => {
      const currentAnchor = anchorRef.current;

      if (!currentAnchor) {
        return;
      }

      const appElement = currentAnchor.closest('.report-card') as HTMLElement | null;
      const layerRect = targetLayer.getBoundingClientRect();
      const boundaryRect = (!useFixedLayer && portalContainer)
        ? layerRect
        : (!useFixedLayer && appElement)
        ? appElement.getBoundingClientRect()
        : {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight,
          };
      const resolvedAnchorRect = anchorRect ?? currentAnchor.getBoundingClientRect();
      const padding = 12;
      const gap = 8;
      const visibleLeft = Math.max(boundaryRect.left, 0);
      const visibleRight = Math.min(boundaryRect.right, window.innerWidth);
      const visibleTop = Math.max(boundaryRect.top, 0);
      const visibleBottom = Math.min(boundaryRect.bottom, window.innerHeight);
      const boundaryWidth = Math.max(180, visibleRight - visibleLeft - padding * 2);
      // pinLeft: keep expectedWidth. matchAnchorWidth: stretch to trigger, else keep expectedWidth.
      const desiredWidth = typeof pinLeft === 'number' || !matchAnchorWidth
        ? expectedWidth
        : Math.max(expectedWidth, resolvedAnchorRect.width);
      const width = Math.min(desiredWidth, boundaryWidth);
      const minViewportLeft = visibleLeft + padding;
      const maxViewportLeft = visibleRight - padding - width;
      // Left-align under the trigger by default (pinLeft still wins).
      const preferredViewportLeft = typeof pinLeft === 'number'
        ? boundaryRect.left + pinLeft
        : horizontalPlacement === 'right'
          ? resolvedAnchorRect.right - width + offsetLeft
          : resolvedAnchorRect.left + offsetLeft;
      const spaceBelow = visibleBottom - padding - (resolvedAnchorRect.bottom + gap);
      const spaceAbove = resolvedAnchorRect.top - gap - (visibleTop + padding);
      // Prefer under the trigger when there is usable space — do not require full expectedHeight.
      const minPlaceHeight = Math.min(expectedHeight, 200);
      const placeBelow = verticalPlacement === 'below'
        ? true
        : verticalPlacement === 'anchor-start'
        ? false
        : spaceBelow >= minPlaceHeight || spaceBelow >= spaceAbove;
      const preferredViewportTop = verticalPlacement === 'anchor-start'
        ? resolvedAnchorRect.top
        : placeBelow
          ? resolvedAnchorRect.bottom + gap
          : Math.max(visibleTop + padding, resolvedAnchorRect.top - Math.min(expectedHeight, Math.max(spaceAbove, 180)) - gap);
      const availableHeight = placeBelow || verticalPlacement === 'anchor-start'
        ? Math.max(180, visibleBottom - padding - preferredViewportTop)
        : Math.max(180, resolvedAnchorRect.top - gap - (visibleTop + padding));
      const viewportLeft =
        maxViewportLeft < minViewportLeft
          ? minViewportLeft
          : clamp(preferredViewportLeft, minViewportLeft, maxViewportLeft);
      const viewportTop = allowVerticalOverflow
        ? preferredViewportTop
        : verticalPlacement === 'below'
          ? Math.max(visibleTop + padding, preferredViewportTop)
          : clamp(
              preferredViewportTop,
              visibleTop + padding,
              Math.max(visibleTop + padding, visibleBottom - padding - 180),
            );

      setStyle({
        position: useFixedLayer ? 'fixed' : undefined,
        zIndex: useFixedLayer ? 5600 : undefined,
        width,
        left: useFixedLayer ? viewportLeft : viewportLeft - layerRect.left + targetLayer.scrollLeft,
        top: useFixedLayer ? viewportTop : viewportTop - layerRect.top + targetLayer.scrollTop,
        maxHeight: constrainHeight
          ? Math.min(expectedHeight, availableHeight)
          : undefined,
        overflowY: constrainHeight ? 'auto' : undefined,
        visibility: 'visible',
      });
    };

    frame = requestAnimationFrame(update);
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    window.addEventListener('resize', scheduleUpdate);
    if (updateOnScroll) {
      window.addEventListener('scroll', scheduleUpdate, true);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      if (updateOnScroll) {
        window.removeEventListener('scroll', scheduleUpdate, true);
      }
    };
  }, [allowVerticalOverflow, anchorRect, anchorRef, constrainHeight, expectedHeight, expectedWidth, horizontalPlacement, matchAnchorWidth, offsetLeft, open, pinLeft, portalContainer, portalToBody, updateOnScroll, verticalPlacement]);

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
      aria-label="Открыть сайт САПП"
    >
      {logoAvailable && (
        <img
          src="/sapp-logo.svg"
          alt="САПП"
          onError={() => setLogoAvailable(false)}
        />
      )}
      {!logoAvailable && <span>САПП</span>}
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
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onContextMenu,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
  ariaPressed?: boolean;
  disabled?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
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
      onPointerDown={onPointerDown}
      onPointerUp={(event) => {
        setTooltipStyle(null);
        onPointerUp?.(event);
      }}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
      aria-label={label}
      aria-pressed={ariaPressed}
      disabled={disabled}
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
  tooltipLabel,
  disabled = false,
  onClick,
}: {
  className?: string;
  valueLabel: string;
  tooltipLabel?: string;
  disabled?: boolean;
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
    const label = tooltipLabel ?? valueLabel;
    const estimatedWidth = Math.min(maxWidth, Math.max(112, label.length * 7 + 24));
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
      className={`value-cell value-cell-button ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      type="button"
      disabled={disabled}
      aria-label={tooltipLabel ?? valueLabel}
      onClick={disabled ? undefined : onClick}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      ref={buttonRef}
    >
      <span className="value-cell-badge">{valueLabel}</span>
      {!disabled ? (
        <span className="value-cell-corner-arrow" aria-hidden="true">
          ↗
        </span>
      ) : null}
      {tooltipStyle && <TooltipPortal label={tooltipLabel ?? valueLabel} style={tooltipStyle} />}
    </button>
  );
}

export function CustomSelect<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
  menuGroup,
  menuKey,
  menuClassName = 'select-menu',
  expectedWidth = 220,
  expectedHeight = 280,
  verticalPlacement = 'auto',
  closeOnScroll = true,
  onOpen,
  freezePopoverPositionOnOpen = false,
  popoverPortalToBody = false,
  popoverUpdateOnScroll = true,
}: {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  menuGroup?: string;
  menuKey?: string;
  menuClassName?: string;
  expectedWidth?: number;
  expectedHeight?: number;
  verticalPlacement?: 'auto' | 'anchor-start' | 'below';
  closeOnScroll?: boolean;
  onOpen?: () => void;
  freezePopoverPositionOnOpen?: boolean;
  popoverPortalToBody?: boolean;
  popoverUpdateOnScroll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [frozenAnchorRect, setFrozenAnchorRect] = useState<Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'> | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(
    open,
    () => {
      setOpen(false);
      setFrozenAnchorRect(null);
    },
    [popoverRef],
    { closeOnScroll },
  );
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!menuGroup || !menuKey) {
      return undefined;
    }

    const handleMenuOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ group?: string; key?: string }>).detail;

      if (detail?.group === menuGroup && detail.key !== menuKey) {
        setOpen(false);
        setFrozenAnchorRect(null);
      }
    };

    window.addEventListener('nested-menu-open', handleMenuOpen);

    return () => {
      window.removeEventListener('nested-menu-open', handleMenuOpen);
    };
  }, [menuGroup, menuKey]);

  const captureAnchorRect = () => {
    const rect = ref.current?.getBoundingClientRect();

    if (!rect) {
      setFrozenAnchorRect(null);
      return;
    }

    setFrozenAnchorRect({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
  };

  const toggleOpen = () => {
    setOpen((current) => {
      const nextOpen = !current;

      if (nextOpen && menuGroup && menuKey) {
        window.dispatchEvent(new CustomEvent('nested-menu-open', {
          detail: { group: menuGroup, key: menuKey },
        }));
      }
      if (nextOpen) {
        if (freezePopoverPositionOnOpen) {
          captureAnchorRect();
        }
        onOpen?.();
      } else {
        setFrozenAnchorRect(null);
      }

      return nextOpen;
    });
  };

  return (
    <div className={`select-shell ${className} ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          anchorRect={freezePopoverPositionOnOpen ? frozenAnchorRect : null}
          popoverRef={popoverRef}
          open={open}
          className={menuClassName}
          expectedWidth={expectedWidth}
          expectedHeight={expectedHeight}
          verticalPlacement={verticalPlacement}
          updateOnScroll={popoverUpdateOnScroll}
          portalToBody={popoverPortalToBody}
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
                setFrozenAnchorRect(null);
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


