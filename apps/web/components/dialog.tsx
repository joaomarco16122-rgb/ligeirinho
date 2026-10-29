'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

/** Dialog with keyboard containment and focus restoration. Destructive forms control when closing is allowed. */
export function Dialog({
  title,
  eyebrow,
  onClose,
  closeLabel = 'Fechar formulário',
  wide = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose?: () => void;
  closeLabel?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const section = panel.current;
    if (!section) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    section.focus();
    const focusable = () =>
      Array.from(
        section.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('hidden'));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && close.current) {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        section.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !section.contains(event.target)) section.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={panel}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          {onClose && (
            <button type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>
        {children}
      </section>
    </div>
  );
}
