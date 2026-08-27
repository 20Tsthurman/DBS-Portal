"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMonthLabel } from "@/app/owner/calendar/_lib/timezone";
import { ContentItemsList } from "./ContentItemsList";
import { CycleFormPanel } from "./CycleFormPanel";
import { ItemFormPanel } from "./ItemFormPanel";
import {
  deleteContentCycleAction,
  deleteContentItemAction,
} from "../_actions";
import { cycleStatusLabelFor, cycleStatusToneFor } from "../_lib/format";
import type { ContentItemWithAssets, CycleWithClient } from "../_lib/queries";

interface ContentBoardProps {
  items: ContentItemWithAssets[];
  cycles: CycleWithClient[];
  /** null = the all-clients view, which is read-only for cycle actions. */
  clientId: string | null;
  clientName: string;
  monthKey: string;
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
}: ContentBoardProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] =
    useState<ContentItemWithAssets | null>(null);
  const [confirmDeleteCycle, setConfirmDeleteCycle] = useState(false);
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

  return (
    <div>
      {allClients ? (
        <div style={bannerStyle}>
          Showing every client&apos;s posts for {formatMonthLabel(monthKey)}.
          Pick a client to add or edit content.
        </div>
      ) : (
        <div style={cycleBarStyle}>
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
              </div>
            ) : (
              <div style={cycleMetaStyle}>
                <span>No cycle for this month yet.</span>
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
                <Button
                  type="button"
                  onClick={() => setPanel({ kind: "item", item: null })}
                >
                  New post
                </Button>
              </>
            ) : (
              <Button type="button" onClick={() => setPanel({ kind: "cycle" })}>
                Create cycle
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={errorBannerStyle}>
          {error}
        </div>
      )}

      <ContentItemsList
        items={items}
        showClient={allClients}
        onEdit={(item) => setPanel({ kind: "item", item })}
        onDelete={(item) => setConfirmDeleteItem(item)}
      />

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
