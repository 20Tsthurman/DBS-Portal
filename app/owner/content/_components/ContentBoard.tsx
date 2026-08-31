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
import { ContentItemsList } from "./ContentItemsList";
import { CycleFormPanel } from "./CycleFormPanel";
import { ItemFormPanel } from "./ItemFormPanel";
import {
  deleteContentCycleAction,
  deleteContentItemAction,
  releaseContentCycleAction,
  unreleaseContentCycleAction,
} from "../_actions";
import { cycleStatusLabelFor, cycleStatusToneFor } from "../_lib/format";
import type { ContentCalendarEvent } from "../_lib/calendarEvents";
import type { ContentView } from "../_lib/href";
import type { ContentItemWithAssets, CycleWithClient } from "../_lib/queries";
import type { ReleaseGateResult } from "../_lib/releaseGate";
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
   * Client review progress for a released cycle, or null when there is no
   * released cycle on screen. Informational only (spec 4.5) — nothing on this
   * board keys off it.
   */
  rollup: CycleRollup | null;
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
  rollup,
}: ContentBoardProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] =
    useState<ContentItemWithAssets | null>(null);
  const [confirmDeleteCycle, setConfirmDeleteCycle] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [confirmUnrelease, setConfirmUnrelease] = useState(false);
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

  const deadlineLabel = cycle?.revision_deadline
    ? fullDateLabelForDateKey(dateKeyInTimezone(new Date(cycle.revision_deadline)))
    : null;
  const releaseBlockedReason =
    releaseGate && !releaseGate.ok ? releaseGate.reason : null;
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
                  {cycle.extra_round_price === null
                    ? "Extra round price not set"
                    : `Extra round $${cycle.extra_round_price.toFixed(2)}`}
                </span>
                <span>
                  {deadlineLabel
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
