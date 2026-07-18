"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  formatCurrency,
  formatDate,
} from "@/app/owner/clients/_lib/format";
import type { CommitResult } from "../_lib/types";

type BaseProps = {
  label: string;
  align?: "left" | "right";
  emptyDisplay?: ReactNode;
  placeholder?: string;
};

type DateProps = BaseProps & {
  type: "date";
  value: string | null;
  onCommit: (newValue: string | null) => Promise<CommitResult>;
};

type MoneyProps = BaseProps & {
  type: "money";
  value: number | null;
  onCommit: (newValue: number | null) => Promise<CommitResult>;
};

type NumberProps = BaseProps & {
  type: "number";
  value: number | null;
  onCommit: (newValue: number | null) => Promise<CommitResult>;
};

type TextProps = BaseProps & {
  type: "text";
  value: string | null;
  onCommit: (newValue: string | null) => Promise<CommitResult>;
};

type EnumProps = BaseProps & {
  type: "enum";
  value: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
  onCommit: (newValue: string | null) => Promise<CommitResult>;
};

export type InlineCellProps =
  | DateProps
  | MoneyProps
  | NumberProps
  | TextProps
  | EnumProps;

export function InlineCell(props: InlineCellProps) {
  const [mode, setMode] = useState<"display" | "editing">("display");
  const [draft, setDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const committingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  const align =
    props.align ??
    (props.type === "money" || props.type === "number" ? "right" : "left");

  const valueToDraft = (): string => {
    switch (props.type) {
      case "date":
        return props.value ?? "";
      case "money":
      case "number":
        return props.value === null ? "" : String(props.value);
      case "text":
        return props.value ?? "";
      case "enum":
        return props.value ?? "";
    }
  };

  const enterEditMode = () => {
    if (mode === "editing") return;
    setDraft(valueToDraft());
    setMode("editing");
  };

  type ParseResult =
    | { ok: true; value: string | number | null }
    | { ok: false; error: string };

  const parseDraft = (): ParseResult => {
    switch (props.type) {
      case "date": {
        if (draft === "") return { ok: true, value: null };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
          return { ok: false, error: "Invalid date" };
        }
        return { ok: true, value: draft };
      }
      case "money":
      case "number": {
        const cleaned = draft.replace(/^\$/, "").replace(/,/g, "").trim();
        if (cleaned === "") return { ok: true, value: null };
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n <= 0) {
          return { ok: false, error: "Must be greater than 0" };
        }
        return { ok: true, value: n };
      }
      case "text": {
        const trimmed = draft.trim();
        return { ok: true, value: trimmed === "" ? null : trimmed };
      }
      case "enum": {
        if (draft === "") return { ok: true, value: null };
        if (!props.options.some((o) => o.value === draft)) {
          return { ok: false, error: "Invalid option" };
        }
        return { ok: true, value: draft };
      }
    }
  };

  const isUnchanged = (parsed: string | number | null): boolean => {
    return parsed === props.value;
  };

  const tryCommit = () => {
    if (committingRef.current) return;

    const result = parseDraft();
    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (isUnchanged(result.value)) {
      setError(null);
      setMode("display");
      return;
    }

    committingRef.current = true;
    startTransition(async () => {
      let res: CommitResult;
      try {
        switch (props.type) {
          case "date":
            res = await props.onCommit(result.value as string | null);
            break;
          case "money":
          case "number":
            res = await props.onCommit(result.value as number | null);
            break;
          case "text":
            res = await props.onCommit(result.value as string | null);
            break;
          case "enum":
            res = await props.onCommit(result.value as string | null);
            break;
        }
      } finally {
        committingRef.current = false;
      }

      if (res.ok) {
        setError(null);
        setMode("display");
      } else {
        setError(res.error ?? "Save failed");
      }
    });
  };

  const cancel = () => {
    if (isPending) return;
    setError(null);
    setDraft(valueToDraft());
    setMode("display");
  };

  const handleKey = (
    e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const handleBlur = () => {
    if (committingRef.current) return;
    tryCommit();
  };

  useEffect(() => {
    if (mode !== "editing") return;
    if (props.type === "enum") {
      selectRef.current?.focus();
      return;
    }
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (props.type !== "date") {
      input.select();
    }
  }, [mode, props.type]);

  if (mode === "display") {
    const isEmpty =
      props.type === "text"
        ? props.value === null
        : props.value === null;
    const showPlaceholder = isEmpty && props.placeholder !== undefined;

    const formatted: ReactNode = (() => {
      if (showPlaceholder) return props.placeholder;
      switch (props.type) {
        case "date":
          return props.value === null ? "" : formatDate(props.value);
        case "money":
          return props.value === null ? "" : formatCurrency(props.value);
        case "number":
          return props.value === null ? "" : String(props.value);
        case "text":
          return props.value ?? props.emptyDisplay ?? "—";
        case "enum": {
          if (props.value === null) return "";
          const opt = props.options.find((o) => o.value === props.value);
          return opt ? opt.label : props.value;
        }
      }
    })();

    const cellClass = `fb-cell-display${
      showPlaceholder ? " fb-cell-display-empty" : ""
    }${error ? " fb-cell-error" : ""}`;

    return (
      <button
        type="button"
        onClick={enterEditMode}
        onFocus={enterEditMode}
        title={error ?? undefined}
        aria-label={props.label}
        className={cellClass}
        style={{ ...displayButtonStyle, textAlign: align }}
      >
        {formatted}
      </button>
    );
  }

  const borderColor = error
    ? "var(--status-danger)"
    : "var(--accent)";

  if (props.type === "enum") {
    return (
      <select
        ref={selectRef}
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        title={error ?? undefined}
        aria-label={props.label}
        style={{
          ...editFieldStyle,
          textAlign: align,
          borderColor,
          opacity: isPending ? 0.85 : 1,
        }}
      >
        {props.value === null && draft === "" && (
          <option value="" disabled>
            {props.placeholder ?? "Select…"}
          </option>
        )}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      type={props.type === "date" ? "date" : "text"}
      value={draft}
      disabled={isPending}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKey}
      onBlur={handleBlur}
      title={error ?? undefined}
      aria-label={props.label}
      style={{
        ...editFieldStyle,
        textAlign: align,
        borderColor,
        opacity: isPending ? 0.85 : 1,
      }}
    />
  );
}

// displayButtonStyle and editFieldStyle MUST keep the same font-size: the cell
// swaps between them on tap, and any mismatch reflows the row mid-edit. 16px is
// required on the edit side to suppress iOS Safari's auto-zoom on focus, so the
// display side follows it. Height is deliberately left to the existing 14px
// padding (~45px) — these are inline table cells, not standalone form fields.
const displayButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "14px 16px",
  fontSize: 16,
  fontFamily: "inherit",
  color: "inherit",
  background: "transparent",
  border: "1px solid transparent",
  cursor: "pointer",
};

const editFieldStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "14px 16px",
  fontSize: 16,
  fontFamily: "inherit",
  color: "var(--text-primary)",
  background: "#FFFFFF",
  border: "1px solid var(--border)",
  outline: "none",
};
