import Link from "next/link";
import type { CSSProperties } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { dateKeyInTimezone } from "@/lib/date";
import { weekdayDateLabelForDateKey } from "@/app/owner/calendar/_lib/timezone";
import { PostThumb } from "./PostThumb";
import { RoundChip } from "./RoundChip";
import { ROW_ACTION_REVIEW, ROW_ACTION_VIEW } from "../_lib/copy";
import {
  needsClientReview,
  platformLabel,
  postLabel,
  statusPillFor,
} from "../_lib/format";
import type { ReviewItem } from "../_lib/queries";

interface QueueRowProps {
  item: ReviewItem;
  /** 1-based place in the queue, for the "Post 5" caption fallback. */
  positionInQueue: number;
  thumbUrl: string | null;
}

/** Desktop table row. The dark header above it comes from `app/globals.css`. */
export function QueueRow({ item, positionInQueue, thumbUrl }: QueueRowProps) {
  const pill = statusPillFor(item.status);
  const needsReview = needsClientReview(item.status);
  const href = `/client/review/${item.id}`;

  return (
    <tr>
      <td>
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <PostThumb url={thumbUrl} />
          <span style={postCellStyle}>
            {postLabel(item.caption, positionInQueue)}
          </span>
        </div>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {weekdayDateLabelForDateKey(
          dateKeyInTimezone(new Date(item.scheduled_for))
        )}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {platformLabel(item.platform, item.format)}
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          <RoundChip round={item.current_round} />
        </div>
      </td>
      <td style={{ textAlign: "right" }}>
        <Link href={href} style={needsReview ? primaryLinkStyle : linkStyle}>
          {needsReview ? ROW_ACTION_REVIEW : ROW_ACTION_VIEW}
        </Link>
      </td>
    </tr>
  );
}

const postCellStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--text-primary)",
  fontWeight: 500,
};

// 48px tall even in a table row: this is the primary action on the surface and
// the same markup is what a trackpad-less hand aims at on a laptop.
const linkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 14px",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const primaryLinkStyle: CSSProperties = {
  ...linkStyle,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
};
