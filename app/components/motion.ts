import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animates a number from its previous value (0 on first mount in the browser) to `target`.
 * The server and reduced motion users always get the final value.
 */
export function useCountUp(target: number | null | undefined, duration = 900): number | null {
  const safe = target == null || !Number.isFinite(target) ? null : target;
  const [value, setValue] = useState<number | null>(safe);
  const from = useRef<number>(0);
  const first = useRef(true);

  useIsoLayoutEffect(() => {
    if (safe == null) {
      setValue(null);
      return;
    }
    if (prefersReducedMotion()) {
      setValue(safe);
      from.current = safe;
      return;
    }
    const start = first.current ? 0 : (from.current ?? 0);
    first.current = false;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = start + (safe - start) * ease(p);
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = safe;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = safe;
    };
  }, [safe, duration]);

  return value;
}

/** Runs `fn` every `ms` while the tab is visible. */
export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    if (ms == null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") saved.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, prefersReducedMotion() ? Math.min(ms, 60) : ms));
}
