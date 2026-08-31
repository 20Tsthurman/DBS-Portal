import Link from "next/link";
import type { CSSProperties } from "react";
import {
  MobileCard,
  MobileCardActions,
  MobileCardField,
} from "@/components/ui/MobileCard";
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

interface QueueCardProps {
  item: ReviewItem;
  positionInQueue: number;
  thumbUrl: string | null;
}

/**
 * The mobile half of the row/card split (`InvoicesTable.tsx` established the
 * pattern; `ContentItemsList` repeats it owner-side).
 *
 * The header is hand-rolled rather than `MobileCardHeader` because this one
 * leads with a thumbnail beside the title, which that primitive has no slot
 * for. Everything below it is the shared primitives unchanged.
 */
export function QueueCard({ item, positionInQueue, thumbUrl }: QueueCardProps) {
  const pill = statusPillFor(item.status);
  const needsReview = needsClientReview(item.status);
  const scheduled = weekdayDateLabelForDateKey(
    dateKeyInTimezone(new Date(item.scheduled_for))
  );

  return (
    <MobileCard>
      <div
        className="flex items-start gap-3 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <PostThumb url={thumbUrl} size="card" />
        <div className="min-w-0 flex-1">
          <div style={titleStyle}>
            {postLabel(item.caption, positionInQueue)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
            <RoundChip round={item.current_round} />
          </div>
        </div>
      </div>

      <MobileCardField label="Scheduled">{scheduled}</MobileCardField>
      <MobileCardField label="Platform">
        {platformLabel(item.platform, item.format)}
      </MobileCardField>

      <MobileCardActions>
        <Link
          href={`/client/review/${item.id}`}
          style={needsReview ? primaryActionStyle : actionStyle}
        >
          {needsReview ? ROW_ACTION_REVIEW : ROW_ACTION_VIEW}
        </Link>
      </MobileCardActions>
    </MobileCard>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 16,
  fontWeight: 500,
  color: "var(--text-primary)",
  lineHeight: 1.3,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

// Full-width on a phone: one action per card, and a thumb-sized target for the
// only thing there is to do here would be a poor joke on the stated audience.
const actionStyle: CSSProperties = {
  flex: 1,
  justifyContent: "center",
  minHeight: 48,
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const primaryActionStyle: CSSProperties = {
  ...actionStyle,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
};
