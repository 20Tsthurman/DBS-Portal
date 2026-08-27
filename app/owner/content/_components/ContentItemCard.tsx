"use client";

import type { CSSProperties } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  MobileCard,
  MobileCardActions,
  MobileCardField,
  MobileCardHeader,
} from "@/components/ui/MobileCard";
import { formatShortTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import {
  FORMAT_LABELS,
  PLATFORM_LABELS,
  formatAssetCount,
  itemStatusLabelFor,
  itemStatusToneFor,
} from "../_lib/format";
import type { ContentItemWithAssets } from "../_lib/queries";

interface ContentItemCardProps {
  item: ContentItemWithAssets;
  showClient: boolean;
  onEdit: (item: ContentItemWithAssets) => void;
  onDelete: (item: ContentItemWithAssets) => void;
}

/** Mobile counterpart to `ContentItemRow`, over the shared MobileCard primitives. */
export function ContentItemCard({
  item,
  showClient,
  onEdit,
  onDelete,
}: ContentItemCardProps) {
  return (
    <MobileCard>
      <MobileCardHeader
        title={
          <span style={{ fontFamily: "var(--font-playfair), serif" }}>
            {formatShortTimeInTimezone(new Date(item.scheduled_for))}
            {" · "}
            {PLATFORM_LABELS[item.platform]}
          </span>
        }
        badge={
          <StatusPill tone={itemStatusToneFor(item.status)}>
            {itemStatusLabelFor(item.status)}
          </StatusPill>
        }
      />
      {showClient && (
        <MobileCardField label="Client">{item.client_name}</MobileCardField>
      )}
      <MobileCardField label="Format">
        {FORMAT_LABELS[item.format]}
      </MobileCardField>
      <MobileCardField label="Photos">
        {formatAssetCount(item.assets.length)}
      </MobileCardField>
      {item.caption && (
        <MobileCardField label="Caption">
          <span style={captionStyle}>{item.caption}</span>
        </MobileCardField>
      )}
      <MobileCardActions>
        <button type="button" onClick={() => onEdit(item)} style={actionStyle}>
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          style={{ ...actionStyle, color: "var(--status-danger)" }}
        >
          Delete
        </button>
      </MobileCardActions>
    </MobileCard>
  );
}

const captionStyle: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const actionStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
};
