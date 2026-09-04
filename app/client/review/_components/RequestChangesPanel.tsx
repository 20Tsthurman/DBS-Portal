"use client";

import {
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  fieldStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { RevisionCategory } from "@/lib/supabase";
import { formatChargeAmount, type RoundBilling } from "@/lib/revisionBilling";
import {
  CATEGORY_COPY,
  CATEGORY_FIELD_PLACEHOLDER,
  CATEGORY_ORDER,
  DISABLED_SEND_HELPER,
  FOOTER_HELPER_INCLUDED,
  FOOTER_HELPER_ROUND_1,
  MOMENTS_HEADING,
  MOMENTS_HELPER,
  MOMENTS_NO_TIMECODE,
  MOMENTS_PLACEHOLDER,
  REQUEST_CHANGES_HELPER,
  REQUEST_CHANGES_TITLE,
  SEND_BUTTON,
  SEND_DIALOG_CANCEL,
  SEND_DIALOG_FINALITY,
  SEND_DIALOG_LINE_1,
  SEND_DIALOG_LINE_3,
  SEND_DIALOG_LINE_3_INCLUDED,
  SEND_DIALOG_TITLE,
  SEND_FAILED,
  SEND_FAILED_TERMS_CHANGED,
  consentAmountRow,
  consentConfirmLabel,
  consentDialogTitle,
  consentSubLine,
  coveredSubLine,
  footerHelperCharge,
  footerHelperCovered,
  momentsAddLabel,
  momentsChip,
} from "../_lib/copy";
import { consentFor, TERMS_CHANGED_ERROR } from "../_lib/consent";
import { formatTimecode } from "../_lib/format";
import {
  getPlayerPositionSnapshot,
  getPlayerPositionServerSnapshot,
  subscribePlayerPosition,
} from "../_lib/playerPosition";
import { submitChangeRequestAction } from "../_actions";

/** One "Notes on moments" entry. `seconds` keeps the precise scrubber value
 * (revision_notes.timestamp_seconds is numeric); the chip shows it floored. */
export interface MomentDraft {
  id: number;
  seconds: number;
  body: string;
}

interface RequestChangesPanelProps {
  open: boolean;
  onClose: () => void;
  /** The post being asked about — the submit action's target. */
  itemId: string;
  /** "Saturday, Oct 10 · Instagram Reel" — deck Screen 3's context line. */
  contextLine: string;
  /** The moments section renders ONLY on posts with a video (deck rule). */
  hasVideo: boolean;
  /** The post's `current_round` — named in the round-2+ copy. */
  round: number;
  /**
   * What sending this round costs, resolved server-side by the item page
   * through the SAME function the submit action uses at its commit
   * (`resolveMyRoundBilling`). Chooses the footer line, the dialog, and the
   * consent that travels with the send.
   */
  billing: RoundBilling;
  /** `content_cycles.included_rounds` — the Screen 9 sub-line names it. */
  includedRounds: number;
}

/**
 * The guided request-changes form (deck Screen 3).
 *
 * GUIDED, NEVER FREE-TEXT: fixed categories, one comment field revealed per
 * selected category, optional timestamp notes on video posts. Free-text
 * feedback produces unactionable notes (spec §5.3); the categories are the
 * whole point and there is no other input path.
 *
 * EVERY STRING IS A DECK ROW, imported from `_lib/copy.ts` — nothing here may
 * be reworded at build time.
 *
 * SEND IS GATED, per the 2026-08-31 ruling: at least one category selected AND
 * every selected category carrying a non-empty comment. Moments are an add-on
 * and never enable Send on their own — though an added moment left empty also
 * holds Send, so nothing a client typed (or half-added) is ever silently
 * dropped. The deck's disabled-send helper appears only in the
 * nothing-selected state it was written for; an empty comment field sits
 * visibly empty directly above the button and needs no second explanation.
 *
 * FORM STATE SURVIVES CLOSE. `SlidePanel` keeps its children mounted while
 * closed (inert), which the moments flow depends on: a client can close the
 * panel, pause the video somewhere else, reopen, and add another note without
 * losing a word. State resets only when the page unmounts — i.e. when they
 * leave the post.
 *
 * SEND OPENS THE SCREEN 4 CONFIRMATION — `ConfirmDialog` at full weight,
 * deliberately unchanged: accent bar, Playfair title. The contrast against
 * the lighter ApproveDialog is the signal for which action deserves the
 * longer pause, and it must not be flattened. The dialog's summary chips are
 * built from the form: selected categories in deck order, then the moments
 * count. On confirm the submit action runs; success refreshes the route,
 * which re-renders the post as Screen 5's locked state (this whole component
 * leaves the tree — the item no longer needs review). Failure keeps the
 * panel open with the deck's send-failed line, and not a word of the draft
 * is lost. Deselecting a category keeps its typed comment in state (kinder
 * to a stray tap) — only selected categories are submitted.
 *
 * THE BILLING STATE PICKS THE FOOTER AND THE DIALOG (Phase 8, from the deck
 * rows added 2026-09-04):
 *
 *   included  — Screen 4, the send dialog: round 1 carries its two
 *               included-round lines; round 2+ carries the included pair
 *               (billing off for the cycle, or a round within the included
 *               count). No amount anywhere.
 *   charge    — Screen 9, the consent dialog: title names the round, the
 *               amount row and sub-line sit before the finality line, and the
 *               price repeats on the confirm button so consent is unmissable.
 *   covered   — Screen 9 with the money removed: per_round, another post
 *               already opened this round's charge. Same title, the covered
 *               sub-line in the amount row's place, Screen 4's confirm label.
 *
 * THE CONSENT TRAVELS WITH THE SEND. `consentFor(billing)` goes to the action,
 * and the commit writes a charge only when its own computation matches it
 * exactly (`consentMatches`); a mismatch — Kelsey edited the cycle's terms
 * between this page's load and the press — is refused with nothing written
 * and rendered as the deck's terms-changed line, which tells the client to
 * refresh. A retry from the same stale page would fail identically, which is
 * why that failure does not share SEND_FAILED's "try again in a moment".
 */
export function RequestChangesPanel({
  open,
  onClose,
  itemId,
  contextLine,
  hasVideo,
  round,
  billing,
  includedRounds,
}: RequestChangesPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<RevisionCategory[]>([]);
  const [comments, setComments] = useState<
    Partial<Record<RevisionCategory, string>>
  >({});
  const [moments, setMoments] = useState<MomentDraft[]>([]);
  const nextMomentId = useRef(1);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<"failed" | "terms" | null>(null);

  // The deck's amount shape, computed once: "$75", cents only when present.
  const amountLabel =
    billing.kind === "charge" ? formatChargeAmount(billing.price) : null;
  const footerLine =
    billing.kind === "charge" && amountLabel !== null
      ? footerHelperCharge(round, amountLabel)
      : billing.kind === "covered"
        ? footerHelperCovered(round)
        : round < 2
          ? FOOTER_HELPER_ROUND_1
          : FOOTER_HELPER_INCLUDED;
  const dialogTitle =
    billing.kind === "included" ? SEND_DIALOG_TITLE : consentDialogTitle(round);
  const confirmLabel =
    billing.kind === "charge" && amountLabel !== null
      ? consentConfirmLabel(amountLabel)
      : SEND_BUTTON;

  const position = useSyncExternalStore(
    subscribePlayerPosition,
    getPlayerPositionSnapshot,
    getPlayerPositionServerSnapshot
  );

  const toggleCategory = (category: RevisionCategory) => {
    setSelected((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const addMoment = () => {
    if (!position.hasPosition) return;
    setMoments((prev) => [
      ...prev,
      { id: nextMomentId.current++, seconds: position.seconds, body: "" },
    ]);
  };

  const removeMoment = (id: number) => {
    setMoments((prev) => prev.filter((m) => m.id !== id));
  };

  const nothingSelected = selected.length === 0;
  const everySelectedCommented = selected.every(
    (c) => (comments[c] ?? "").trim().length > 0
  );
  const everyMomentFilled = moments.every((m) => m.body.trim().length > 0);
  const canSend =
    !nothingSelected && everySelectedCommented && everyMomentFilled;

  // Deck order, not selection order, so the chips read the way the form does.
  const selectedInOrder = CATEGORY_ORDER.filter((c) => selected.includes(c));
  const summaryChips = [
    ...selectedInOrder.map((c) => CATEGORY_COPY[c].label),
    ...(moments.length > 0 ? [momentsChip(moments.length)] : []),
  ];

  const handleConfirmSend = async () => {
    if (submitting) return;
    setSendError(null);
    setSubmitting(true);
    const result = await submitChangeRequestAction({
      itemId,
      categories: selectedInOrder.map((c) => ({
        category: c,
        body: (comments[c] ?? "").trim(),
      })),
      moments: moments.map((m) => ({
        seconds: m.seconds,
        body: m.body.trim(),
      })),
      // Exactly what this dialog showed. The server refuses to write a charge
      // that differs from it.
      consent: consentFor(billing),
    });
    setSubmitting(false);
    setConfirming(false);
    if (!result.ok) {
      // Two lines: the terms-changed refusal has its own (a retry from this
      // page would fail the same way), every other failure shares the deck's
      // send-failed row. The draft stays exactly as typed either way, panel
      // open behind the dismissed dialog.
      setSendError(result.error === TERMS_CHANGED_ERROR ? "terms" : "failed");
      return;
    }
    onClose();
    // The refreshed page renders the item locked (Screen 5); this component
    // leaves the tree with it.
    router.refresh();
  };

  return (
    <>
      <SlidePanel
        open={open}
        onClose={onClose}
        title={REQUEST_CHANGES_TITLE}
        widthPx={440}
      >
      <p style={contextStyle}>{contextLine}</p>
      <p style={helperStyle}>{REQUEST_CHANGES_HELPER}</p>

      <div style={{ marginTop: 16 }}>
        {CATEGORY_ORDER.map((category) => {
          const copy = CATEGORY_COPY[category];
          const isSelected = selected.includes(category);
          return (
            <div key={category} style={categoryBlockStyle}>
              <label style={categoryRowStyle}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCategory(category)}
                  style={checkboxStyle}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={categoryLabelStyle}>{copy.label}</span>
                  <span style={categoryHintStyle}> — {copy.hint}</span>
                </span>
              </label>

              {isSelected && (
                <div style={commentBlockStyle}>
                  <label style={promptStyle} htmlFor={`rvw-cat-${category}`}>
                    {copy.prompt}
                  </label>
                  <textarea
                    id={`rvw-cat-${category}`}
                    value={comments[category] ?? ""}
                    onChange={(e) =>
                      setComments((prev) => ({
                        ...prev,
                        [category]: e.target.value,
                      }))
                    }
                    placeholder={CATEGORY_FIELD_PLACEHOLDER}
                    rows={3}
                    style={textareaStyle}
                    onFocus={applyFocus}
                    onBlur={clearFocus}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasVideo && (
        <div style={momentsSectionStyle}>
          <h3 style={momentsHeadingStyle}>{MOMENTS_HEADING}</h3>
          <p style={helperStyle}>{MOMENTS_HELPER}</p>

          {moments.map((moment) => (
            <div key={moment.id} style={momentBlockStyle}>
              <div style={momentTopRowStyle}>
                <span style={timecodeChipStyle}>
                  {formatTimecode(moment.seconds)}
                </span>
                <button
                  type="button"
                  onClick={() => removeMoment(moment.id)}
                  aria-label="Remove note"
                  style={momentRemoveStyle}
                >
                  ×
                </button>
              </div>
              <textarea
                value={moment.body}
                onChange={(e) =>
                  setMoments((prev) =>
                    prev.map((m) =>
                      m.id === moment.id ? { ...m, body: e.target.value } : m
                    )
                  )
                }
                placeholder={MOMENTS_PLACEHOLDER}
                rows={2}
                style={textareaStyle}
                onFocus={applyFocus}
                onBlur={clearFocus}
              />
            </div>
          ))}

          {/* Deck rule (added 2026-08-31): until the video has a position,
              helper text stands IN PLACE OF the button — never a disabled
              "Add a note at 0:00". The timecode on the button is live. */}
          {position.hasPosition ? (
            <button type="button" onClick={addMoment} style={momentAddStyle}>
              {momentsAddLabel(formatTimecode(position.seconds))}
            </button>
          ) : (
            <p style={noTimecodeStyle}>{MOMENTS_NO_TIMECODE}</p>
          )}
        </div>
      )}

      <div style={footerStyle}>
        {sendError && (
          <p role="alert" style={sendErrorStyle}>
            {sendError === "terms" ? SEND_FAILED_TERMS_CHANGED : SEND_FAILED}
          </p>
        )}
        <p style={footerHelperStyle}>{footerLine}</p>
        <button
          type="button"
          disabled={!canSend || submitting}
          onClick={() => setConfirming(true)}
          style={canSend ? sendStyle : sendDisabledStyle}
        >
          {SEND_BUTTON}
        </button>
        {nothingSelected && (
          <p style={disabledHelperStyle}>{DISABLED_SEND_HELPER}</p>
        )}
      </div>

      </SlidePanel>

      {/* Screen 4 — the full-weight house ConfirmDialog, unchanged: accent
          bar, Playfair title. Its heft against the lighter ApproveDialog is
          the design's signal and must not be flattened. A SIBLING of the
          SlidePanel, not a child (ItemFormPanel's arrangement): the panel's
          transform makes it the containing block for fixed descendants, so a
          dialog inside would center in the panel instead of the viewport.
          Outside, its z-index (100/101) clears the panel's (40/50). */}
      <ConfirmDialog
        open={confirming}
        onCancel={() => {
          if (submitting) return;
          setConfirming(false);
        }}
        onConfirm={handleConfirmSend}
        title={dialogTitle}
        body={
          <div>
            <div style={chipsRowStyle}>
              {summaryChips.map((chip) => (
                <span key={chip} style={chipStyle}>
                  {chip}
                </span>
              ))}
            </div>
            <p style={dialogLineStyle}>{SEND_DIALOG_LINE_1}</p>

            {/* Screen 9's money, BEFORE the finality line (the deck's row
                order): the amount row and its sub-line on a charge, the
                covered sub-line alone when another post already opened the
                round. Screen 4 has nothing here. */}
            {billing.kind === "charge" && amountLabel !== null && (
              <>
                <p style={amountRowStyle}>{consentAmountRow(round, amountLabel)}</p>
                <p style={dialogLineStyle}>{consentSubLine(includedRounds)}</p>
              </>
            )}
            {billing.kind === "covered" && (
              <p style={dialogLineStyle}>{coveredSubLine(round)}</p>
            )}

            <p style={dialogLineStyle}>
              <strong style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {SEND_DIALOG_FINALITY.emphasized}
              </strong>
              {SEND_DIALOG_FINALITY.rest}
            </p>

            {/* Screen 4's third line, on an included round only: the round-1
                sentence, or the round-2+ included row. */}
            {billing.kind === "included" && (
              <p style={dialogLineStyle}>
                {round < 2 ? SEND_DIALOG_LINE_3 : SEND_DIALOG_LINE_3_INCLUDED}
              </p>
            )}
          </div>
        }
        confirmLabel={confirmLabel}
        cancelLabel={SEND_DIALOG_CANCEL}
        busy={submitting}
      />
    </>
  );
}

const contextStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--text-muted)",
};

const helperStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--text-body)",
};

const categoryBlockStyle: CSSProperties = {
  borderBottom: "1px solid var(--border)",
};

const categoryRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 48,
  padding: "6px 0",
  cursor: "pointer",
};

const checkboxStyle: CSSProperties = {
  width: 18,
  height: 18,
  flex: "0 0 auto",
  accentColor: "var(--accent)",
  cursor: "pointer",
};

const categoryLabelStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const categoryHintStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
};

const commentBlockStyle: CSSProperties = {
  padding: "0 0 14px 30px",
};

const promptStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-body)",
};

// fieldStyle's 16px font is load-bearing on iOS (focus zoom); minHeight
// relaxed from the input default so `rows` governs the box.
const textareaStyle: CSSProperties = {
  ...fieldStyle,
  minHeight: 0,
  resize: "vertical",
  lineHeight: 1.5,
};

const momentsSectionStyle: CSSProperties = {
  marginTop: 20,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const momentsHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const momentBlockStyle: CSSProperties = {
  marginTop: 12,
  border: "1px solid var(--border)",
  padding: 10,
};

const momentTopRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};

// Forest chip, matching the round marker's visual language.
const timecodeChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  backgroundColor: "#1B3827",
  color: "#F2EDE4",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
};

const momentRemoveStyle: CSSProperties = {
  width: 48,
  height: 48,
  margin: "-14px -14px -14px 0", // 48px target without inflating the row
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 20,
  lineHeight: 1,
  cursor: "pointer",
};

const momentAddStyle: CSSProperties = {
  marginTop: 12,
  width: "100%",
  minHeight: 48,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.04em",
  fontFamily: "inherit",
  cursor: "pointer",
};

const noTimecodeStyle: CSSProperties = {
  margin: "12px 0 0",
  fontSize: 13,
  color: "var(--text-muted)",
};

const footerStyle: CSSProperties = {
  marginTop: 24,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const footerHelperStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 13,
  color: "var(--text-body)",
};

const sendBase: CSSProperties = {
  width: "100%",
  minHeight: 48,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 18px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

const sendStyle: CSSProperties = {
  ...sendBase,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
  cursor: "pointer",
};

const sendDisabledStyle: CSSProperties = {
  ...sendBase,
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  opacity: 0.5,
  cursor: "not-allowed",
};

const disabledHelperStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13,
  color: "var(--text-muted)",
  textAlign: "center",
};

const sendErrorStyle: CSSProperties = {
  margin: "0 0 12px",
  padding: "10px 12px",
  border: "1px solid var(--status-danger)",
  backgroundColor: "rgba(122,48,64,0.08)",
  color: "var(--status-danger)",
  fontSize: 13,
  lineHeight: 1.5,
};

const chipsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginBottom: 12,
};

// Forest chips, matching the timecode chip and the deck's round marker.
const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 10px",
  backgroundColor: "#1B3827",
  color: "#F2EDE4",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
};

const dialogLineStyle: CSSProperties = {
  margin: "0 0 10px",
  lineHeight: 1.5,
};

// Screen 9's amount row — the one line in the dialog that names money. Set
// apart in weight and colour, not size or box, so it reads as a fact the
// client is agreeing to rather than as an alarm.
const amountRowStyle: CSSProperties = {
  margin: "0 0 4px",
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.5,
  color: "var(--text-primary)",
};
