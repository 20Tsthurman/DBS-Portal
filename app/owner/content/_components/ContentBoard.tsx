"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  formatMonthLabel,
  fullDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import {
  formatChargeAmount,
  type RevisionCharge,
} from "@/lib/revisionBilling";
import { ContentItemsList } from "./ContentItemsList";
import { CycleFormPanel } from "./CycleFormPanel";
import { ItemFormPanel } from "./ItemFormPanel";
import {
  deleteContentCycleAction,
  deleteContentItemAction,
  releaseContentCycleAction,
  lockContentCycleAction,
  rereleaseContentCycleAction,
  unreleaseContentCycleAction,
} from "../_actions";
import {
  cycleStatusLabelFor,
  cycleStatusToneFor,
  revisionChargeLabel,
  revisionChargeStateFor,
} from "../_lib/format";
import type { ContentCalendarEvent } from "../_lib/calendarEvents";
import type { ContentView } from "../_lib/href";
import type { ContentItemWithAssets, CycleWithClient } from "../_lib/queries";
import type {
  ReleaseGateResult,
  RereleaseGateResult,
} from "../_lib/releaseGate";
import { ContentCalendar } from "./ContentCalendar";
import { ContentRollup } from "./ContentRollup";
import type { CycleRollup } from "../_lib/rollup";

interface ContentBoardProps {
  items: ContentItemWithAssets[];
  cycles: CycleWithClient[];
  /** null = the all-clients view, which is read-only for cycle actions. */
  clientId: string | null;
  clientName: string;
  monthKey: string;
  view: ContentView;
  /**
   * Calendar events for `view="calendar"` — mapped and thumb-minted
   * server-side by the page. Empty in list view, where they aren't needed.
   */
  events: ContentCalendarEvent[];
  /**
   * Server-computed release readiness for the visible cycle, or null when
   * there is nothing releasable on screen (all-clients view, no cycle, or a
   * cycle that is not `drafting`).
   *
   * A HINT, NOT THE AUTHORITY. It is a snapshot from the last server render
   * and goes stale the moment a video finishes transcoding, so it only decides
   * what the button looks like. `releaseContentCycleAction` re-runs the same
   * gate against its own queries after the press, and that result is the one
   * that counts.
   */
  releaseGate: ReleaseGateResult | null;
  /**
   * Server-computed re-release readiness for an `in_review` cycle, or null
   * when there is none on screen. The same hint-not-authority contract as
   * `releaseGate`: `rereleaseContentCycleAction` re-runs the gate after the
   * press. A blocked gate with a null reason is the idle state — nothing to
   * send back, nothing waiting — and renders no note, just a disabled button.
   */
  rereleaseGate: RereleaseGateResult | null;
  /**
   * Client review progress for a released cycle, or null when there is no
   * released cycle on screen. Informational only (spec 4.5) — nothing on this
   * board keys off it.
   */
  rollup: CycleRollup | null;
  /**
   * Accrued revision charges for the visible cycle, in every state (spec
   * §4.9). Informational here — the place Kelsey acts on one is the invoice
   * panel, which reads the same function. Empty when there are none, in the
   * all-clients view, or on a month with no cycle.
   */
  charges: RevisionCharge[];
}

/**
 * Which slide-over is showing. A single discriminated union rather than one
 * boolean per panel: `SlidePanel`'s body scroll-lock is not re-entrant (see
 * its lines 56–58), so two open at once would leave the page locked. Modelling
 * it this way makes that unrepresentable.
 */
type OpenPanel =
  | { kind: "cycle" }
  | { kind: "item"; item: ContentItemWithAssets | null }
  | null;

export function ContentBoard({
  items,
  cycles,
  clientId,
  clientName,
  monthKey,
  view,
  events,
  releaseGate,
  rereleaseGate,
  rollup,
  charges,
}: ContentBoardProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] =
    useState<ContentItemWithAssets | null>(null);
  const [confirmDeleteCycle, setConfirmDeleteCycle] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [confirmUnrelease, setConfirmUnrelease] = useState(false);
  const [confirmRerelease, setConfirmRerelease] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One cycle per client per month, so a client-scoped view has 0 or 1.
  const cycle = clientId ? (cycles[0] ?? null) : null;
  const allClients = clientId === null;

  const closePanel = () => setPanel(null);

  const handleConfirmDeleteItem = async () => {
    if (!confirmDeleteItem) return;
    setError(null);
    setBusy(true);
    const result = await deleteContentItemAction(confirmDeleteItem.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not delete post");
      setConfirmDeleteItem(null);
      return;
    }
    setConfirmDeleteItem(null);
    router.refresh();
  };

  const handleConfirmDeleteCycle = async () => {
    if (!cycle) return;
    setError(null);
    setBusy(true);
    const result = await deleteContentCycleAction(cycle.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not delete cycle");
      setConfirmDeleteCycle(false);
      return;
    }
    setConfirmDeleteCycle(false);
    router.refresh();
  };

  const handleConfirmRelease = async () => {
    if (!cycle) return;
    setError(null);
    setBusy(true);
    const result = await releaseContentCycleAction(cycle.id);
    setBusy(false);
    setConfirmRelease(false);
    if (!result.ok) {
      // The gate re-ran server-side and said no, or the write failed. Either
      // way the reason is the server's, never the stale hint the button used.
      setError(result.error ?? "Could not release this month");
      return;
    }
    router.refresh();
  };

  const handleConfirmUnrelease = async () => {
    if (!cycle) return;
    setError(null);
    setBusy(true);
    const result = await unreleaseContentCycleAction(cycle.id);
    setBusy(false);
    setConfirmUnrelease(false);
    if (!result.ok) {
      setError(result.error ?? "Could not unrelease this month");
      return;
    }
    router.refresh();
  };

  const handleConfirmRerelease = async () => {
    if (!cycle) return;
    setError(null);
    setBusy(true);
    const result = await rereleaseContentCycleAction(cycle.id);
    setBusy(false);
    setConfirmRerelease(false);
    if (!result.ok) {
      // The gate re-ran server-side and said no, or the write failed — the
      // reason is the server's, never the stale hint the button used.
      setError(result.error ?? "Could not re-release this month");
      return;
    }
    router.refresh();
  };

  const handleConfirmLock = async () => {
    if (!cycle) return;
    setError(null);
    setBusy(true);
    const result = await lockContentCycleAction(cycle.id);
    setBusy(false);
    setConfirmLock(false);
    if (!result.ok) {
      setError(result.error ?? "Could not lock this month");
      return;
    }
    router.refresh();
  };

  const deadlineLabel = cycle?.revision_deadline
    ? fullDateLabelForDateKey(dateKeyInTimezone(new Date(cycle.revision_deadline)))
    : null;
  // The day reviews actually closed (migration 018) — the deadline for a
  // sweep close, earlier for a Lock now. Shown in the deadline's slot once
  // the month is locked, since "Reviews close <past date>" would be a lie
  // about a month she closed by hand.
  const lockedLabel = cycle?.locked_at
    ? fullDateLabelForDateKey(dateKeyInTimezone(new Date(cycle.locked_at)))
    : null;
  const releaseBlockedReason =
    releaseGate && !releaseGate.ok ? releaseGate.reason : null;
  // Null both when the gate passes and when it is idle: only an actionable
  // blocker earns a line under the cycle bar.
  const rereleaseBlockedReason =
    rereleaseGate && !rereleaseGate.ok ? rereleaseGate.reason : null;
  const rereleaseReady = rereleaseGate?.ok === true;
  const rereleaseCount = rereleaseGate?.ok ? rereleaseGate.promotions.length : 0;
  // The rollup strip renders joined to the bottom of the cycle bar, so the bar
  // gives up its bottom margin and the strip drops its top border.
  const showRollup = Boolean(cycle && rollup && cycle.status === "in_review");

  return (
    <div>
      {allClients ? (
        <div style={bannerStyle}>
          Showing every client&apos;s posts for {formatMonthLabel(monthKey)}.
          Pick a client to add or edit content.
        </div>
      ) : (
        <div style={{ ...cycleBarStyle, marginBottom: showRollup ? 0 : 16 }}>
          <div className="min-w-0">
            <div style={cycleTitleStyle}>
              {clientName} · {formatMonthLabel(monthKey)}
            </div>
            {cycle ? (
              <div style={cycleMetaStyle}>
                <StatusPill tone={cycleStatusToneFor(cycle.status)}>
                  {cycleStatusLabelFor(cycle.status)}
                </StatusPill>
                <span>
                  {cycle.included_rounds} included{" "}
                  {cycle.included_rounds === 1 ? "round" : "rounds"}
                </span>
                <span>
                  {/* The three billing states the editor can produce, in the
                      deck's amount format: unset, off (0), or a price with
                      its mode. */}
                  {cycle.extra_round_price === null
                    ? "Extra round price not set"
                    : cycle.extra_round_price > 0
                      ? `Extra round ${formatChargeAmount(cycle.extra_round_price)} · ${
                          cycle.billing_mode === "per_item" ? "per post" : "per round"
                        }`
                      : "Revision charges off"}
                </span>
                <span>
                  {cycle.status === "locked" && lockedLabel
                    ? `Reviews closed ${lockedLabel}${
                        cycle.locked_by === "owner" ? " (locked early)" : ""
                      }`
                    : deadlineLabel
                      ? `Reviews close ${deadlineLabel}`
                      : "No review deadline set"}
                </span>
              </div>
            ) : (
              <div style={cycleMetaStyle}>
                <span>No cycle for this month yet.</span>
              </div>
            )}

            {releaseBlockedReason && (
              <p style={gateNoteStyle}>
                Not ready to release — {releaseBlockedReason}
              </p>
            )}
            {rereleaseBlockedReason && (
              <p style={gateNoteStyle}>
                Not ready to re-release — {rereleaseBlockedReason}
              </p>
            )}

            {/* Accrued revision charges (spec §4.9), one line each, in the
                four states `revisionChargeStateFor` names. Read-only: the
                place to act on a ready charge is the invoice panel, which
                lists the same charges from the same read. A charge here is
                PENDING money, never income — nothing on this board or
                anywhere else sums it until the invoice is paid. */}
            {cycle && charges.length > 0 && (
              <div style={chargesBlockStyle}>
                <span style={chargesHeadingStyle}>Revision charges</span>
                {charges.map((charge) => {
                  const state = revisionChargeStateFor(charge);
                  return (
                    <div key={charge.key} style={chargeRowStyle}>
                      <span style={chargeLabelStyle}>
                        {revisionChargeLabel(charge)} ·{" "}
                        {formatChargeAmount(charge.amount)}
                      </span>
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      {charge.state === "waived" && !charge.invoice && (
                        <span style={chargeNoteStyle}>every request denied</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={cycleActionsStyle}>
            {cycle ? (
              <>
                <button
                  type="button"
                  onClick={() => setPanel({ kind: "cycle" })}
                  style={secondaryActionStyle}
                >
                  Edit cycle
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteCycle(true)}
                  style={{
                    ...secondaryActionStyle,
                    color: "var(--status-danger)",
                  }}
                >
                  Delete cycle
                </button>
                {cycle.status === "in_review" && (
                  <button
                    type="button"
                    onClick={() => setConfirmUnrelease(true)}
                    disabled={busy}
                    style={secondaryActionStyle}
                  >
                    Unrelease
                  </button>
                )}
                {cycle.status === "in_review" && (
                  // Lock now (spec §4.6) — the override for a client who has
                  // said they are finished. A plain secondary control, not a
                  // danger-coloured one: it destroys nothing, and the confirm
                  // dialog carries the "can't be undone" weight. The sweep is
                  // the primary mechanism; this is the exception.
                  <button
                    type="button"
                    onClick={() => setConfirmLock(true)}
                    disabled={busy}
                    style={secondaryActionStyle}
                  >
                    Lock now
                  </button>
                )}
                <Button
                  type="button"
                  onClick={() => setPanel({ kind: "item", item: null })}
                >
                  New post
                </Button>
                {cycle.status === "drafting" && (
                  // `variant="secondary"` (forest) rather than the mauve
                  // primary: "New post" is the control Kelsey presses twenty
                  // times a month and Release is the one she presses once, so
                  // Release reads as the distinct, heavier action instead of
                  // competing for the same slot.
                  //
                  // Disabled here is a HINT from the last server render. The
                  // action re-checks; a stale enabled button fails with the
                  // real reason rather than releasing something unready.
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || releaseBlockedReason !== null}
                    title={releaseBlockedReason ?? undefined}
                    onClick={() => setConfirmRelease(true)}
                  >
                    Release
                  </Button>
                )}
                {cycle.status === "in_review" && (
                  // Re-release takes Release's slot and weight once the month
                  // is out: the same forest secondary, the same "heavier
                  // action" reasoning. Disabled while the gate is blocked OR
                  // idle — with nothing to send back there is nothing for the
                  // button to do, and the missing note under the bar says so
                  // by its absence. The action re-checks; this is a hint.
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || !rereleaseReady}
                    title={rereleaseBlockedReason ?? undefined}
                    onClick={() => setConfirmRerelease(true)}
                  >
                    Re-release
                  </Button>
                )}
              </>
            ) : (
              <Button type="button" onClick={() => setPanel({ kind: "cycle" })}>
                Create cycle
              </Button>
            )}
          </div>
        </div>
      )}

      {showRollup && cycle && rollup && (
        <ContentRollup cycleId={cycle.id} initial={rollup} />
      )}

      {error && (
        <div role="alert" style={errorBannerStyle}>
          {error}
        </div>
      )}

      {view === "calendar" ? (
        <ContentCalendar
          monthKey={monthKey}
          clientId={clientId}
          events={events}
          onEditItem={(itemId) => {
            // Tiles carry only the item id; the full item (what the panel
            // needs) is looked up here so events stay lean.
            const item = items.find((i) => i.id === itemId);
            if (item) setPanel({ kind: "item", item });
          }}
        />
      ) : (
        <ContentItemsList
          items={items}
          showClient={allClients}
          onEdit={(item) => setPanel({ kind: "item", item })}
          onDelete={(item) => setConfirmDeleteItem(item)}
        />
      )}

      <CycleFormPanel
        open={panel?.kind === "cycle"}
        onClose={closePanel}
        cycle={cycle}
        clientId={clientId}
        clientName={clientName}
        monthKey={monthKey}
      />

      <ItemFormPanel
        open={panel?.kind === "item"}
        onClose={closePanel}
        item={panel?.kind === "item" ? panel.item : null}
        cycleId={cycle?.id ?? null}
        monthKey={monthKey}
        clientName={clientName}
      />

      <ConfirmDialog
        open={confirmDeleteItem !== null}
        onCancel={() => {
          if (busy) return;
          setConfirmDeleteItem(null);
        }}
        onConfirm={handleConfirmDeleteItem}
        title="Delete post?"
        body="The post and its photos are deleted. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        busy={busy}
      />

      <ConfirmDialog
        open={confirmDeleteCycle}
        onCancel={() => {
          if (busy) return;
          setConfirmDeleteCycle(false);
        }}
        onConfirm={handleConfirmDeleteCycle}
        title="Delete cycle?"
        body={
          <>
            Deleting {clientName || "this client"}&apos;s{" "}
            {formatMonthLabel(monthKey)} cycle also deletes{" "}
            <strong>
              {items.length} {items.length === 1 ? "post" : "posts"}
            </strong>{" "}
            and every photo on them. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete cycle"
        variant="danger"
        busy={busy}
      />

      <ConfirmDialog
        open={confirmRelease}
        onCancel={() => {
          if (busy) return;
          setConfirmRelease(false);
        }}
        onConfirm={handleConfirmRelease}
        title="Release this month?"
        body={
          <>
            <strong>
              {items.length} {items.length === 1 ? "post" : "posts"}
            </strong>{" "}
            become visible to {clientName || "this client"} right away, and
            they get an email with a link to review them.
            {deadlineLabel ? ` Reviews close ${deadlineLabel}.` : ""} You can
            unrelease afterwards — anything they have already approved is kept.
          </>
        }
        confirmLabel="Release"
        variant="success"
        busy={busy}
      />

      <ConfirmDialog
        open={confirmUnrelease}
        onCancel={() => {
          if (busy) return;
          setConfirmUnrelease(false);
        }}
        onConfirm={handleConfirmUnrelease}
        title="Unrelease this month?"
        body={
          <>
            The month goes back to drafting and disappears from{" "}
            {clientName || "this client"}&apos;s portal, even if they are
            partway through reviewing it. Nothing they have done is lost —
            approvals stay approved, and releasing again picks up where they
            left off and adds any new posts.
          </>
        }
        confirmLabel="Unrelease"
        busy={busy}
      />

      <ConfirmDialog
        open={confirmRerelease}
        onCancel={() => {
          if (busy) return;
          setConfirmRerelease(false);
        }}
        onConfirm={handleConfirmRerelease}
        title="Re-release this month?"
        body={
          <>
            <strong>
              {rereleaseCount} updated {rereleaseCount === 1 ? "post goes" : "posts go"}
            </strong>{" "}
            back to {clientName || "this client"} for another look, and they
            get an email. Everything else stays as it is — approved posts stay
            approved, denied requests stay denied, and the review deadline
            {deadlineLabel ? ` (${deadlineLabel})` : ""} doesn&apos;t change.
          </>
        }
        confirmLabel="Re-release"
        variant="success"
        busy={busy}
      />

      <ConfirmDialog
        open={confirmLock}
        onCancel={() => {
          if (busy) return;
          setConfirmLock(false);
        }}
        onConfirm={handleConfirmLock}
        title="Lock this month now?"
        body={
          <>
            Reviews close for {clientName || "this client"}&apos;s{" "}
            {formatMonthLabel(monthKey)} right away.{" "}
            <strong>
              Anything they haven&apos;t reviewed is approved automatically
            </strong>
            , anything they sent notes on stays with you, and they can&apos;t
            approve or request changes after this. This can&apos;t be undone —
            there is no unlock. Use it when the client has told you they&apos;re
            finished.
          </>
        }
        confirmLabel="Lock now"
        variant="danger"
        busy={busy}
      />
    </div>
  );
}

const bannerStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "12px 16px",
  marginBottom: 16,
  fontSize: 13,
  color: "var(--text-body)",
};

const cycleBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "12px 16px",
  marginBottom: 16,
};

const cycleTitleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 16,
  color: "var(--text-primary)",
};

const cycleMetaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  marginTop: 6,
  fontSize: 12,
  color: "var(--text-muted)",
};

const gateNoteStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: 12,
  color: "var(--status-warning)",
};

const cycleActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

const chargesBlockStyle: CSSProperties = {
  marginTop: 10,
  paddingTop: 8,
  borderTop: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const chargesHeadingStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const chargeRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  fontSize: 13,
};

const chargeLabelStyle: CSSProperties = {
  color: "var(--text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const chargeNoteStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const secondaryActionStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  minHeight: 44,
  padding: "0 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
};

const errorBannerStyle: CSSProperties = {
  padding: "10px 12px",
  marginBottom: 16,
  border: "1px solid var(--status-danger)",
  backgroundColor: "rgba(122,48,64,0.08)",
  color: "var(--status-danger)",
  fontSize: 13,
};
