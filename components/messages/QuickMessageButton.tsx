"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { MessageThread } from "@/components/messages/MessageThread";

interface QuickMessageButtonProps {
  clientId: string;
  viewerRole: "owner" | "client";
  label?: string;
  animationStyle?: "inline-expand" | "slide-drawer";
}

const PANEL_HEIGHT_PX = 500;

export function QuickMessageButton({
  clientId,
  viewerRole,
  label = "Message Kelsey",
  animationStyle = "inline-expand",
}: QuickMessageButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (animationStyle === "slide-drawer") {
      console.warn(
        "[QuickMessageButton] animationStyle='slide-drawer' is not implemented yet, falling back to inline-expand"
      );
    }
  }, [animationStyle]);

  useEffect(() => {
    if (!isExpanded) return;

    const handlePointer = (event: MouseEvent) => {
      const root = wrapperRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setIsExpanded(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isExpanded]);

  const openHref =
    viewerRole === "client"
      ? "/client/messages"
      : `/owner/messages?clientId=${encodeURIComponent(clientId)}`;

  return (
    <div ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        style={triggerButtonStyle}
        aria-expanded={isExpanded}
      >
        {label}
      </button>

      <div
        style={{
          ...panelOuterStyle,
          maxHeight: isExpanded ? PANEL_HEIGHT_PX + 60 : 0,
          opacity: isExpanded ? 1 : 0,
          marginTop: isExpanded ? 12 : 0,
        }}
        aria-hidden={!isExpanded}
      >
        <div style={panelInnerStyle}>
          <div style={topBarStyle}>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              style={closeButtonStyle}
              aria-label="Close messages panel"
            >
              ×
            </button>
            <span style={topBarLabelStyle}>Messages</span>
            <Link href={openHref} style={openFullLinkStyle}>
              Open full page →
            </Link>
          </div>

          {isExpanded && (
            <div style={threadWrapStyle}>
              <MessageThread clientId={clientId} viewerRole={viewerRole} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const triggerButtonStyle: CSSProperties = {
  padding: "10px 20px",
  border: "none",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
};

const panelOuterStyle: CSSProperties = {
  overflow: "hidden",
  transition:
    "max-height 280ms ease-in-out, opacity 200ms ease-in-out, margin-top 200ms ease-in-out",
};

const panelInnerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-base)",
  height: PANEL_HEIGHT_PX,
};

const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
};

const closeButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  padding: "2px 6px",
  fontFamily: "inherit",
};

const topBarLabelStyle: CSSProperties = {
  color: "var(--text-primary)",
  fontSize: 14,
  fontWeight: 500,
};

const openFullLinkStyle: CSSProperties = {
  color: "var(--accent)",
  fontSize: 13,
  textDecoration: "none",
};

const threadWrapStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};
