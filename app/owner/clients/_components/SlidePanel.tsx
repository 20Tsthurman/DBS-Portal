"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Panel width in pixels. Defaults to 400; invoices pass 520 to fit
   * the line-items editor without cramping descriptions. */
  widthPx?: number;
  children: ReactNode;
}

// Tab-cycle candidates. Deliberately narrow — every consumer is a form built
// from native controls, so there's no need to chase contenteditable or
// audio/video controls here.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Focusable descendants that are actually rendered (skips `display:none`). */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => el.getClientRects().length > 0);
}

export function SlidePanel({
  open,
  onClose,
  title,
  widthPx,
  children,
}: SlidePanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Scroll-lock the body while the panel is open — the same save/restore used
  // by EditSheet. That idiom is not re-entrant (a second lock would capture
  // "hidden" as its `prev` and restore it on close, locking the page for
  // good), so it is only safe because no route can have two of these open at
  // once: every consumer drives `open` from a single piece of state, and the
  // one EditSheet surface (/owner/financials) mounts no SlidePanel. Revisit if
  // a panel ever opens another panel.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Move focus into the panel on open, and hand it back on close.
  //
  // Focus lands on the container (which is `tabIndex={-1}`) rather than the
  // first field, matching EditSheet: auto-focusing an input pops the on-screen
  // keyboard before the user has chosen to type.
  //
  // Restore is conditional because two consumers — RequestShootFormPanel and
  // TimeBlockFormPanel — mount already-open and close by navigating, so the
  // element that was focused beforehand may no longer be in the document.
  // Focusing a detached node silently drops focus to <body>; checking
  // `isConnected` keeps that case a no-op instead.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  // Trap Tab within the panel. Without this, tabbing past the last field walks
  // into the page behind — which is still fully interactive underneath.
  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = focusableWithin(panel);
    if (focusable.length === 0) {
      // Nothing to cycle through; keep focus pinned to the container.
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.2)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease-out",
          zIndex: 40,
        }}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        // The panel stays mounted while closed so the slide-out transition can
        // run, which used to leave every field inside it keyboard-reachable —
        // on the Shoots page that's one hidden dialog per row. `inert` (React
        // 19 passes the boolean straight through) removes the subtree from the
        // tab order, the a11y tree, and hit-testing in one attribute.
        inert={!open}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: `${widthPx ?? 400}px`,
          maxWidth: "100%",
          backgroundColor: "var(--surface-raised)",
          borderLeft: "1px solid var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease-out",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          pointerEvents: open ? "auto" : "none",
          outline: "none",
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2
            style={{
              fontFamily: "var(--font-playfair), serif",
              color: "var(--text-primary)",
              fontSize: "20px",
              fontWeight: 500,
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              width: 32,
              height: 32,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-body)",
              backgroundColor: "transparent",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </>
  );
}
