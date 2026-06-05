"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { ActiveTimerView } from "@/app/owner/tasks/_lib/queries";
import { stopTimer } from "@/app/owner/tasks/_actions";

interface TimerPillProps {
  initialTimer: ActiveTimerView | null;
}

// Seconds past which the timer is treated as a runaway (§7) — visual warning
// only; Stop still logs the real elapsed time.
const RUNAWAY_SECONDS = 8 * 60 * 60;

function elapsedSecondsSince(startedAt: string): number {
  const startedMs = new Date(startedAt).getTime();
  return Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
}

/** "M:SS" under an hour, "H:MM:SS" once it crosses an hour. */
function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

/** Whole-minutes label for the stop toast, e.g. "45m" / "2h" / "1h 20m". */
function formatLoggedMinutes(loggedHours: number): string {
  const totalMinutes = Math.max(0, Math.round(loggedHours * 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function TimerPill({ initialTimer }: TimerPillProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The active timer, seeded from the server and cleared locally on Stop. A new
  // server value (navigation / refresh) re-seeds it via the effect below.
  const [timer, setTimer] = useState<ActiveTimerView | null>(initialTimer);
  const [elapsed, setElapsed] = useState<number>(() =>
    initialTimer ? elapsedSecondsSince(initialTimer.started_at) : 0
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed from the server whenever the layout passes a new value (e.g. the
  // pill was started/stopped on another page, then this one re-rendered).
  useEffect(() => {
    setTimer(initialTimer);
    setElapsed(initialTimer ? elapsedSecondsSince(initialTimer.started_at) : 0);
  }, [initialTimer]);

  // 1s display tick, derived purely from started_at (no accumulation drift).
  useEffect(() => {
    if (!timer) return;
    setElapsed(elapsedSecondsSince(timer.started_at));
    const id = setInterval(() => {
      setElapsed(elapsedSecondsSince(timer.started_at));
    }, 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Clear any pending toast timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const handleStop = useCallback(() => {
    startTransition(async () => {
      const res = await stopTimer();
      if (!res.ok) {
        showToast(res.error ?? "Could not stop the timer.");
        return;
      }
      // Clear the pill immediately; the server already logged + revalidated.
      setTimer(null);
      setElapsed(0);
      const stopped = res.data ?? null;
      if (stopped) {
        const client = stopped.clientName ?? "client";
        showToast(
          `Logged ${formatLoggedMinutes(stopped.loggedHours)} to ${client} — ${stopped.category}`
        );
      }
      router.refresh();
    });
  }, [router, showToast, startTransition]);

  // No timer running → render nothing (but keep a toast briefly visible after a
  // stop so the confirmation isn't swallowed by the pill disappearing).
  if (!timer) {
    return toast ? <Toast message={toast} /> : null;
  }

  const isRunaway = elapsed >= RUNAWAY_SECONDS;
  // Forest-green pill normally; amber-tinted warning surface when runaway.
  const pillBg = isRunaway ? "var(--status-warning)" : "var(--sidebar-bg)";
  const runawayHours = Math.floor(elapsed / 3600);

  return (
    <>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: pillBg,
          color: "#FFFFFF",
          padding: "6px 8px 6px 14px",
          maxWidth: "min(70vw, 460px)",
        }}
        role="status"
        aria-live="off"
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            backgroundColor: isRunaway ? "#FFFFFF" : "var(--accent)",
            flex: "0 0 auto",
          }}
        />

        <div style={{ minWidth: 0, lineHeight: 1.2 }}>
          {isRunaway ? (
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Running {runawayHours}h — Stop to log
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 220,
                }}
                title={`${timer.clientName ?? "No client"} · ${timer.taskTitle}`}
              >
                {timer.clientName ?? "No client"}
                <span
                  style={{ color: "rgba(255,255,255,0.6)", fontWeight: 400 }}
                >
                  {" "}
                  · {timer.taskTitle}
                </span>
              </span>
            </span>
          )}
        </div>

        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flex: "0 0 auto",
          }}
        >
          {formatElapsed(elapsed)}
        </span>

        <button
          type="button"
          onClick={handleStop}
          disabled={isPending}
          style={{
            backgroundColor: "var(--accent)",
            color: "#FFFFFF",
            border: "none",
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "inherit",
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
            flex: "0 0 auto",
          }}
        >
          {isPending ? "Stopping…" : "Stop"}
        </button>
      </div>

      {toast && <Toast message={toast} />}
    </>
  );
}

// Fixed bottom-right confirmation. Sharp corners + no shadow are enforced
// globally; we use the forest surface for contrast against the cream page.
function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 60,
        backgroundColor: "var(--sidebar-bg)",
        color: "#FFFFFF",
        padding: "10px 14px",
        fontSize: 13,
        maxWidth: "min(90vw, 380px)",
        border: "1px solid var(--border)",
      }}
    >
      {message}
    </div>
  );
}
