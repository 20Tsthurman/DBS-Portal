"use client";

const RING_RADIUS = 12;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Determinate progress ring for a direct-to-storage upload.
 *
 * Lifted verbatim out of FilesPanel when the content video upload needed the
 * same thing; both surfaces import it from here rather than keeping two
 * copies that drift. Behaviour is unchanged: at 100% it swaps to a
 * "Finalizing…" label, because every upload path in the portal has a server
 * round trip after the last byte and a ring parked at 100% reads as stuck.
 *
 * `role="status"` + `aria-live="polite"` announce progress without stealing
 * focus; the SVG is `aria-hidden` so the percentage is announced once, not
 * twice.
 */
export function UploadProgressIndicator({ fraction }: { fraction: number }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const finalizing = clamped >= 1;

  if (finalizing) {
    return (
      <span
        role="status"
        aria-live="polite"
        style={{ fontSize: 12, color: "var(--text-body)" }}
      >
        Finalizing…
      </span>
    );
  }

  const percent = Math.round(clamped * 100);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Uploading, ${percent} percent complete`}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true">
        <circle
          cx={14}
          cy={14}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--text-muted)"
          strokeOpacity={0.15}
          strokeWidth={2}
        />
        <circle
          cx={14}
          cy={14}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped)}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <span
        style={{
          fontSize: 12,
          color: "var(--text-body)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {percent}%
      </span>
    </div>
  );
}
