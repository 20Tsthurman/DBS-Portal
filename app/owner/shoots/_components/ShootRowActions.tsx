"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ClientRecord,
  ShootRecord,
  ShootStatus,
} from "@/lib/supabase";
import { ShootFormPanel } from "./ShootFormPanel";
import {
  cancelShoot,
  completeShoot,
  confirmShoot,
  deleteShoot,
} from "../_actions";

interface ShootRowActionsProps {
  shoot: ShootRecord;
  clients: Pick<ClientRecord, "id" | "name">[];
}

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

type StatusActionResult = { ok: boolean; error?: string };

export function ShootRowActions({ shoot, clients }: ShootRowActionsProps) {
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

  const runStatusAction = (
    action: (id: string) => Promise<StatusActionResult>,
    confirmMsg?: string
  ) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setMenuOpen(false);
    startTransition(async () => {
      const r = await action(shoot.id);
      if (!r.ok) {
        alert(r.error ?? "Action failed.");
        return;
      }
      router.refresh();
    });
  };

  const handleEdit = () => {
    setMenuOpen(false);
    setEditOpen(true);
  };

  const handleDelete = () => {
    if (!confirm("Delete this shoot? This cannot be undone.")) return;
    setMenuOpen(false);
    startTransition(async () => {
      const r = await deleteShoot(shoot.id);
      if (!r.ok) {
        alert(r.error ?? "Failed to delete shoot.");
        return;
      }
      router.refresh();
    });
  };

  const items = buildMenuItems(shoot.status, {
    onEdit: handleEdit,
    onConfirm: () => runStatusAction(confirmShoot),
    onComplete: () => runStatusAction(completeShoot),
    onCancel: () => runStatusAction(cancelShoot, "Cancel this shoot?"),
    onDelete: handleDelete,
  });

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
          aria-label="Row actions"
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
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={item.onClick}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: item.danger
                    ? "var(--status-danger)"
                    : "var(--text-body)",
                  backgroundColor: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ShootFormPanel
        open={editOpen}
        onClose={() => setEditOpen(false)}
        clients={clients}
        shoot={shoot}
      />
    </>
  );
}

function buildMenuItems(
  status: ShootStatus,
  handlers: {
    onEdit: () => void;
    onConfirm: () => void;
    onComplete: () => void;
    onCancel: () => void;
    onDelete: () => void;
  }
): MenuItem[] {
  const items: MenuItem[] = [
    { label: "Edit", onClick: handlers.onEdit },
  ];

  if (status === "requested") {
    items.push({ label: "Confirm", onClick: handlers.onConfirm });
    items.push({
      label: "Cancel",
      onClick: handlers.onCancel,
      danger: true,
    });
  } else if (status === "confirmed") {
    items.push({ label: "Mark Complete", onClick: handlers.onComplete });
    items.push({
      label: "Cancel",
      onClick: handlers.onCancel,
      danger: true,
    });
  }

  items.push({ label: "Delete", onClick: handlers.onDelete, danger: true });
  return items;
}
