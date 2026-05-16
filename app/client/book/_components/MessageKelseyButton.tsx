"use client";

import { useState, type CSSProperties } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconMessage, IconChevronRight } from "./Icons";

export function MessageKelseyButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={buttonStyle}
        title="Coming soon"
      >
        <span style={iconSlotStyle}>
          <IconMessage size={18} color="var(--text-body)" />
        </span>
        <span style={{ flex: 1, textAlign: "left" }}>Message Kelsey</span>
        <span style={soonBadgeStyle}>Soon</span>
        <IconChevronRight size={16} color="var(--text-muted)" />
      </button>

      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        title="In-app messaging is on the way"
        body={
          <>
            Messages aren&apos;t available in the portal yet. For now, please
            reach out to Kelsey directly. We&apos;ll have in-app messaging
            available shortly.
          </>
        }
        confirmLabel="OK, got it"
        cancelLabel={null}
      />
    </>
  );
}

const buttonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  backgroundColor: "transparent",
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

const iconSlotStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const soonBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 6px",
  fontSize: 9,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "var(--text-muted)",
  color: "#FFFFFF",
};
