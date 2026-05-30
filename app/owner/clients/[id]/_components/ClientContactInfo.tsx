"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhone } from "../../_lib/format";
import { normalizePhone } from "@/lib/phone";

interface ClientContactInfoProps {
  clientId: string;
  email: string | null;
  phone: string | null;
}

type EditField = "email" | "phone";

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "var(--text-body)",
  letterSpacing: "0.02em",
};

const labelStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  minWidth: 52,
};

const inlineInputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "#FFFFFF",
  padding: "4px 8px",
  fontSize: "13px",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  outline: "none",
  minWidth: 200,
};

// Small text-style trigger/action button used inline in the contact rows.
const linkButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontSize: 13,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
};

/**
 * Contact block on the client detail page. Renders the email and phone when
 * present and offers an inline "Add …" editor for whichever is missing.
 * Writes route through PATCH /api/clients/[id] (the same handler the Edit
 * Client panel uses), which normalizes/validates and enforces at-least-one.
 */
export function ClientContactInfo({
  clientId,
  email,
  phone,
}: ClientContactInfoProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditField | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (field: EditField) => {
    setEditing(field);
    setDraft("");
    setError(null);
  };

  const cancel = () => {
    setEditing(null);
    setDraft("");
    setError(null);
  };

  const save = async (field: EditField) => {
    const trimmed = draft.trim();
    // Client-side sanity check; the route re-validates authoritatively.
    if (field === "email") {
      if (!trimmed.includes("@") || !trimmed.includes(".")) {
        setError("Please enter a valid email address.");
        return;
      }
    } else {
      if (!normalizePhone(trimmed).ok) {
        setError("Please enter a valid 10-digit phone number.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: trimmed }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to save.");
        return;
      }
      setEditing(null);
      setDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  };

  const renderEditor = (field: EditField) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(field);
      }}
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      <input
        type={field === "email" ? "email" : "tel"}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={field === "email" ? "name@email.com" : "(512) 555-1234"}
        style={inlineInputStyle}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      />
      <button type="submit" disabled={saving} style={linkButtonStyle}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        style={{ ...linkButtonStyle, color: "var(--text-muted)" }}
      >
        Cancel
      </button>
    </form>
  );

  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {!email && !phone && editing === null && (
        <p style={{ ...rowStyle, color: "var(--text-muted)" }}>
          No contact info on file
        </p>
      )}

      {/* Email */}
      <div style={rowStyle}>
        <span style={labelStyle}>Email</span>
        {email ? (
          <span>{email}</span>
        ) : editing === "email" ? (
          renderEditor("email")
        ) : (
          <button
            type="button"
            onClick={() => startEdit("email")}
            style={linkButtonStyle}
          >
            Add email address
          </button>
        )}
      </div>

      {/* Phone */}
      <div style={rowStyle}>
        <span style={labelStyle}>Phone</span>
        {phone ? (
          <span>{formatPhone(phone)}</span>
        ) : editing === "phone" ? (
          renderEditor("phone")
        ) : (
          <button
            type="button"
            onClick={() => startEdit("phone")}
            style={linkButtonStyle}
          >
            Add phone number
          </button>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--status-danger)", marginTop: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
