"use client";

import type { CSSProperties } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatShortTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import {
  FORMAT_LABELS,
  PLATFORM_LABELS,
  formatAssetCount,
  itemStatusLabelFor,
  itemStatusToneFor,
} from "../_lib/format";
import type { ContentItemWithAssets } from "../_lib/queries";

interface ContentItemRowProps {
  item: ContentItemWithAssets;
  showClient: boolean;
  onEdit: (item: ContentItemWithAssets) => void;
  onDelete: (item: ContentItemWithAssets) => void;
}

/**
 * Desktop table row. Presentational — the confirm dialog for delete lives on
 * the board so one dialog serves both this and the mobile card.
 */
export function ContentItemRow({
  item,
  showClient,
  onEdit,
  onDelete,
}: ContentItemRowProps) {
  return (
    <tr>
      <td style={cellPrimary}>
        {formatShortTimeInTimezone(new Date(item.scheduled_for))}
      </td>
      {showClient && <td>{item.client_name}</td>}
      <td>{PLATFORM_LABELS[item.platform]}</td>
      <td>{FORMAT_LABELS[item.format]}</td>
      <td style={captionCellStyle}>{item.caption ?? "—"}</td>
      <td>{formatAssetCount(item.assets.length)}</td>
      <td>
        <StatusPill tone={itemStatusToneFor(item.status)}>
          {itemStatusLabelFor(item.status)}
        </StatusPill>
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <button type="button" onClick={() => onEdit(item)} style={rowActionStyle}>
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          style={{ ...rowActionStyle, color: "var(--status-danger)" }}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

const cellPrimary: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 14,
  whiteSpace: "nowrap",
};

// Captions run long; clamp the column so one post can't push the table wide.
const captionCellStyle: CSSProperties = {
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--text-body)",
};

const rowActionStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
  marginLeft: 4,
};
