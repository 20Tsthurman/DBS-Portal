"use client";

/**
 * "Export CPA Package" header control for /owner/financials.
 *
 * Compact mauve button that opens a small popover: a preset dropdown (This Year
 * default, Last Year, Q1–Q4, Custom) plus two native date inputs when Custom is
 * selected. Generate opens the owner-gated download route in a new tab; the
 * route's `attachment` disposition makes the browser download the PDF.
 *
 * Pure client component — it only builds the query string and calls
 * window.open (same pattern as InvoiceRow's PDF download). All aggregation /
 * rendering happens server-side in /api/owner/financials/cpa-package.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

type PresetValue =
  | "this_year"
  | "last_year"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "custom";

const PRESET_OPTIONS: Array<{ value: PresetValue; label: string }> = [
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
  { value: "custom", label: "Custom" },
];

const ENDPOINT = "/api/owner/financials/cpa-package";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function CpaExportButton() {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PresetValue>("this_year");

  // Defaults as string literals (NOT Date objects): Jan 1 of the current year
  // and today. Built from local Date fields, mirroring the route's local-date
  // convention. Only consumed when Custom is selected.
  const [customStart, setCustomStart] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-01-01`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
      now.getDate()
    )}`;
  });

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isCustom = preset === "custom";
  const customInWrongOrder =
    customStart !== "" && customEnd !== "" && customEnd < customStart;
  const customValid =
    customStart !== "" && customEnd !== "" && customEnd >= customStart;
  const generateDisabled = isCustom && !customValid;

  const handleGenerate = () => {
    let url: string;
    if (isCustom) {
      if (!customValid) return;
      url = `${ENDPOINT}?start=${customStart}&end=${customEnd}`;
    } else {
      url = `${ENDPOINT}?preset=${preset}`;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={wrapper}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={triggerButton}
      >
        Export CPA Package
      </button>

      {open ? (
        <div role="dialog" aria-label="Export CPA Package" style={popover}>
          <label htmlFor="cpa-preset" style={fieldLabel}>
            Period
          </label>
          <select
            id="cpa-preset"
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetValue)}
            style={control}
          >
            {PRESET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {isCustom ? (
            <div style={{ marginTop: 12 }}>
              <label htmlFor="cpa-start" style={fieldLabel}>
                From
              </label>
              <input
                id="cpa-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={control}
              />
              <label htmlFor="cpa-end" style={{ ...fieldLabel, marginTop: 10 }}>
                To
              </label>
              <input
                id="cpa-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={control}
              />
              {customInWrongOrder ? (
                <p style={hint}>End date must be on or after the start date.</p>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generateDisabled}
            style={{
              ...generateButton,
              opacity: generateDisabled ? 0.5 : 1,
              cursor: generateDisabled ? "not-allowed" : "pointer",
            }}
          >
            Generate PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}

const wrapper: CSSProperties = {
  position: "relative",
  display: "inline-block",
};

const triggerButton: CSSProperties = {
  height: 36,
  padding: "0 14px",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  flexShrink: 0,
};

const popover: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  zIndex: 50,
  width: 260,
  padding: 14,
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
};

const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-body)",
  marginBottom: 6,
};

// minHeight (not the previous fixed height: 34) so 16px text has room — the
// font-size is what suppresses iOS Safari's auto-zoom on the date inputs and
// the period select.
const control: CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "0 8px",
  border: "1px solid var(--border)",
  backgroundColor: "#FFFFFF",
  color: "var(--text-primary)",
  fontSize: 16,
};

const generateButton: CSSProperties = {
  width: "100%",
  height: 38,
  marginTop: 14,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const hint: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 11,
  color: "var(--status-danger)",
  lineHeight: 1.4,
};
