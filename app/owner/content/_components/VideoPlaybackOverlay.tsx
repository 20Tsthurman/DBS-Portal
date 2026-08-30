"use client";

import { useEffect, useRef, useState } from "react";

interface VideoPlaybackOverlayProps {
  onClose: () => void;
  /** Freshly minted player src; null while the mint is still in flight. */
  iframeUrl: string | null;
  /** Mint failure, rendered where the video would be. */
  error: string | null;
  clientName: string;
  /** "Thursday, May 14, 2026 · 2:30pm · Instagram Reel" — built by the panel
   * from LIVE form values so it always matches what the form says. */
  meta: string;
  caption: string;
}

// What Tab can land on inside the overlay. The iframe is in the list — the
// player's own controls live inside it and keyboard users need a way in.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Full-viewport playback overlay for a ready video, layered over the item
 * panel on /owner/content.
 *
 * NOT a SlidePanel, deliberately: SlidePanel's body scroll-lock is not
 * re-entrant (its lines 56–58 — a second lock would capture "hidden" as its
 * saved value and restore it on close, locking the page for good). This
 * component therefore never touches `document.body.style.overflow`. It can
 * only exist while the panel underneath is open and already holding the lock,
 * and it scrolls internally instead — the same coexistence contract
 * ConfirmDialog already uses to stack above an open panel.
 *
 * Mounting IS opening: the parent renders this only while a video is playing,
 * so closing unmounts the iframe and playback (and its audio) stops with it.
 * There is no `open` prop to leave a hidden iframe playing sound.
 */
export function VideoPlaybackOverlay({
  onClose,
  iframeUrl,
  error,
  clientName,
  meta,
  caption,
}: VideoPlaybackOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const copyTimerRef = useRef<number | null>(null);

  // Escape closes the overlay ONLY. SlidePanel underneath listens for Escape
  // on window in the bubble phase, so an unstopped press would close both
  // layers at once and drop Kelsey back on the board with her form gone from
  // view. Capture phase runs first on window; stopping propagation there
  // means the panel's listener never sees the press. (A press while focus is
  // inside the cross-origin iframe never reaches this document at all — the
  // close button and backdrop cover that case.)
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  // Focus in on open, back out on close. The opener is the play tile inside
  // the still-mounted panel; `isConnected` guards the case where the tile is
  // gone by the time this closes (same idiom as SlidePanel).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
    },
    []
  );

  // Trap Tab. The panel behind is still interactive DOM — without this,
  // tabbing past the last control walks into the form underneath the
  // backdrop.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const root = rootRef.current;
    if (!root) return;

    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /** Close on clicks that land on the backdrop itself, not on content. */
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimerRef.current !== null)
      window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
  };

  const hasCaption = caption.trim() !== "";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${clientName ? `${clientName} — ` : ""}video`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      className="vpo-root"
    >
      <div className="vpo-header">
        <div className="min-w-0">
          {clientName && <div className="vpo-client">{clientName}</div>}
          <div className="vpo-meta">{meta}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="vpo-close"
        >
          ×
        </button>
      </div>

      <div className="vpo-main" onClick={handleBackdropClick}>
        <div className="vpo-video-col">
          {error ? (
            <div role="alert" className="vpo-video vpo-video-note">
              {error}
            </div>
          ) : iframeUrl ? (
            <iframe
              src={iframeUrl}
              title={clientName ? `${clientName} video` : "Video"}
              className="vpo-video"
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
              allowFullScreen
            />
          ) : (
            <div role="status" className="vpo-video vpo-video-note">
              Opening…
            </div>
          )}
        </div>

        <div className="vpo-caption-col">
          <div className="vpo-caption-head">
            <span className="vpo-caption-label">Caption</span>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!hasCaption}
              className="vpo-copy"
            >
              {copyState === "copied"
                ? "Copied"
                : copyState === "failed"
                  ? "Couldn't copy"
                  : "Copy caption"}
            </button>
          </div>
          {hasCaption ? (
            <p className="vpo-caption-text">{caption}</p>
          ) : (
            <p className="vpo-caption-empty">No caption yet.</p>
          )}
        </div>
      </div>

      {/* Component-scoped classes rather than inline styles because the
          desktop/mobile split and the fade-in need real media queries and
          keyframes — the TaskList <style> idiom. Sharp corners and no shadows
          come free from the global `*` reset. */}
      <style>{`
        .vpo-root {
          position: fixed;
          inset: 0;
          z-index: 60; /* above SlidePanel (50); ConfirmDialog stays at 100 */
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overscroll-behavior: contain;
          background-color: rgba(27, 56, 39, 0.97); /* --sidebar-bg, high opacity */
          outline: none;
          animation: vpo-fade-in 150ms ease-out;
        }
        @keyframes vpo-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .vpo-header {
          flex: 0 0 auto;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 20px 24px;
        }
        .vpo-client {
          font-family: var(--font-playfair), serif;
          font-size: 20px;
          font-weight: 500;
          color: #F2EDE4; /* cream on the dark field, throughout */
        }
        .vpo-meta {
          margin-top: 4px;
          font-size: 12px;
          letter-spacing: 0.04em;
          color: rgba(242, 237, 228, 0.65);
        }
        .vpo-close {
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid rgba(242, 237, 228, 0.4);
          color: #F2EDE4;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }
        .vpo-main {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 0 0 32px;
        }
        .vpo-video-col {
          width: 100%;
        }
        .vpo-video {
          display: block;
          width: 100%;
          aspect-ratio: 9 / 16;
          border: none;
          /* --sidebar-deep, so the box reads intentional while the player
             boots or while "Opening…" is up. */
          background-color: #132A1C;
        }
        .vpo-video-note {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          text-align: center;
          font-size: 13px;
          line-height: 1.5;
          color: rgba(242, 237, 228, 0.8);
        }
        .vpo-caption-col {
          padding: 0 24px;
        }
        .vpo-caption-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .vpo-caption-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(242, 237, 228, 0.65);
        }
        .vpo-copy {
          background: transparent;
          border: 1px solid rgba(242, 237, 228, 0.4);
          min-height: 36px;
          padding: 0 14px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #F2EDE4;
          cursor: pointer;
        }
        .vpo-copy:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .vpo-caption-text {
          margin: 0;
          font-size: 14px;
          line-height: 1.6;
          color: #F2EDE4;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .vpo-caption-empty {
          margin: 0;
          font-size: 13px;
          color: rgba(242, 237, 228, 0.55);
        }
        @media (min-width: 900px) {
          .vpo-main {
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 40px;
            padding: 0 24px 32px;
          }
          .vpo-video-col {
            width: auto;
            flex: 0 0 auto;
          }
          .vpo-video {
            /* ~360x640, shrunk on short screens so the whole player is
               visible without scrolling; width follows from the 9:16 ratio. */
            width: auto;
            height: min(640px, calc(100dvh - 150px));
          }
          .vpo-caption-col {
            flex: 0 1 360px;
            padding: 0;
            max-height: min(640px, calc(100dvh - 150px));
            overflow-y: auto;
          }
        }
      `}</style>
    </div>
  );
}
