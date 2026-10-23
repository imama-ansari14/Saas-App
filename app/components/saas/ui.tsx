import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconClose } from "./icons";
import { useCountUp } from "../motion";

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  tone: "good" | "info" | "bad";
  title: string;
  body?: string;
}
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { ...t, id }]);
    window.setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="sx-toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`sx-toast tone-${t.tone}`}>
            <span className="sx-toast-dot" aria-hidden="true" />
            <div>
              <strong>{t.title}</strong>
              {t.body ? <p>{t.body}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ---------- Modal ---------- */

export function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button:not(.sx-modal-x), select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="sx-modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sx-modal${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sx-modal-title" ref={ref}>
        <header className="sx-modal-head">
          <div>
            <h2 id="sx-modal-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="sx-modal-x" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="sx-modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Progress pieces ---------- */

export function Ring({ value, size = 64, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const v = useCountUp(Math.max(0, Math.min(1, value)) * 100, 1100) ?? 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = v >= 85 ? "good" : v >= 50 ? "warn" : "bad";
  return (
    <span className={`sx-ring tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v)} percent`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="sx-ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="sx-ring-fill"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="sx-ring-num">{Math.round(v)}</span>
    </span>
  );
}

export function Bar({ value, tone = "accent" }: { value: number; tone?: string }) {
  return (
    <span className="sx-bar">
      <span className={`sx-bar-fill tone-bg-${tone}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="sx-spin" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function DoneMark({ size = 44 }: { size?: number }) {
  return (
    <span className="sx-done" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 44 44" width={size} height={size}>
        <circle cx="22" cy="22" r="20" className="sx-done-circle" />
        <path d="M13 22.5l6 6 12-13" className="sx-done-check" />
      </svg>
    </span>
  );
}

export type StepState = "todo" | "doing" | "done";

export function Steps({ items }: { items: { label: string; state: StepState; detail?: string }[] }) {
  return (
    <ol className="sx-steps">
      {items.map((s) => (
        <li key={s.label} className={`is-${s.state}`}>
          <span className="sx-step-mark" aria-hidden="true">
            {s.state === "done" ? <IconCheck size={14} /> : s.state === "doing" ? <Spinner size={14} /> : null}
          </span>
          <span className="sx-step-text">
            {s.label}
            {s.detail ? <small>{s.detail}</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StatusPill({ state, children }: { state: "on" | "off" | "busy" | "warn"; children: ReactNode }) {
  return (
    <span className={`sx-status is-${state}`}>
      <span className="sx-status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const v = useCountUp(value, 1200) ?? 0;
  return <>{format(v)}</>;
}
