import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, LoaderCircle, X } from "lucide-react";

export function Button({
  variant = "secondary",
  className = "",
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = "",
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type={type} className={`ui-icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`ui-switch ${checked ? "ui-switch--on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="ui-switch__thumb" />
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  className = "",
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = hint || error ? `${inputId}-description` : undefined;
  return (
    <label className={`ui-field ${className}`.trim()}>
      <span className="ui-field__label">{label}</span>
      <input id={inputId} className="ui-input" aria-invalid={error ? true : undefined} aria-describedby={descriptionId} {...props} />
      {error ? <span id={descriptionId} className="ui-field__error">{error}</span> : hint ? <span id={descriptionId} className="ui-field__hint">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="ui-field">
      <span className="ui-field__label">{label}</span>
      <select className="ui-input ui-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {children}
      </select>
    </label>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ui-toggle-row">
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty-state">
      <span className="ui-empty-state__icon">{icon}</span>
      <strong>{title}</strong>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Notice({ kind = "neutral", children }: {
  kind?: "neutral" | "success" | "warning" | "info" | "danger";
  children: ReactNode;
}) {
  return <div className={`ui-notice ui-notice--${kind}`} role={kind === "danger" ? "alert" : kind === "success" ? "status" : undefined}>{children}</div>;
}

export function StatusPill({ state, children }: {
  state: "idle" | "busy" | "success" | "warning" | "info" | "error";
  children: ReactNode;
}) {
  return (
    <span className={`ui-status-pill ui-status-pill--${state}`}>
      {state === "busy" ? <LoaderCircle size={13} className="ui-spin" /> : null}
      {state === "success" ? <Check size={13} /> : null}
      {state === "warning" ? <AlertTriangle size={13} /> : null}
      {state === "info" ? <Info size={13} /> : null}
      {state === "error" ? <X size={13} /> : null}
      {children}
    </span>
  );
}

export function Panel({ title, description, action, children, className = "" }: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ui-panel ${className}`.trim()}>
      {title || action ? (
        <header className="ui-panel__header">
          <span>
            {title ? <h3>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </span>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "primary",
  busy = false,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="ui-dialog__header">
          <span className={`ui-dialog__icon ui-dialog__icon--${variant}`}><AlertTriangle size={19} /></span>
          <span><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></span>
        </header>
        {children ? <div className="ui-dialog__content">{children}</div> : null}
        <footer className="ui-dialog__actions">
          <Button onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={variant} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </footer>
      </div>
    </div>
  );
}
