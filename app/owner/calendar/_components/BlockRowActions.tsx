"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { AvailabilityBlockRecord } from "@/lib/supabase";
import { AvailabilityBlockFormPanel } from "./AvailabilityBlockFormPanel";
import { deleteAvailabilityBlock } from "../_actions";

interface BlockRowActionsProps {
  block: AvailabilityBlockRecord;
  canEdit: boolean;
}

const menuItemStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-body)",
  backgroundColor: "transparent",
  border: "none",
  cursor: "pointer",
};

export function BlockRowActions({ block, canEdit }: BlockRowActionsProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const handleEdit = () => {
    setMenuOpen(false);
    setEditOpen(true);
  };

  const handleDelete = () => {
    if (!confirm("Delete this availability block? This cannot be undone.")) return;
    setMenuOpen(false);
    startTransition(async () => {
      const r = await deleteAvailabilityBlock(block.id);
      if (!r.ok) {
        alert(r.error ?? "Failed to delete block.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <div
        ref={wrapperRef}
        style={{ position: "relative", display: "inline-block" }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          disabled={pending}
          aria-label="Block actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-body)",
            cursor: pending ? "not-allowed" : "pointer",
            padding: "4px 12px",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ···
        </button>
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 4px)",
              minWidth: 168,
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              zIndex: 30,
            }}
          >
            {canEdit && (
              <button
                type="button"
                role="menuitem"
                onClick={handleEdit}
                style={menuItemStyle}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              style={{ ...menuItemStyle, color: "var(--status-danger)" }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <AvailabilityBlockFormPanel
        open={editOpen}
        onClose={() => setEditOpen(false)}
        block={block}
      />
    </>
  );
}
