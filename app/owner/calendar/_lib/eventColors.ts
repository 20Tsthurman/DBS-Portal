import type { CalendarEvent } from "./types";

export interface EventVisuals {
  background: string;
  borderLeft: string;
  textColor: string;
  textTexture?: "strikethrough" | "italic";
  fillTexture?: "diagonal-stripes" | null;
}

const STRIPES_REQUESTED =
  "repeating-linear-gradient(45deg, transparent 0, transparent 4px, rgba(168, 120, 138, 0.18) 4px, rgba(168, 120, 138, 0.18) 8px)";

export function visualsForEvent(event: CalendarEvent): EventVisuals {
  switch (event.category) {
    case "shoot":
      switch (event.status) {
        case "confirmed":
          return {
            background: "rgba(168, 120, 138, 0.18)",
            borderLeft: "3px solid var(--accent)",
            textColor: "var(--text-primary)",
          };
        case "requested":
          return {
            background: "rgba(168, 120, 138, 0.18)",
            borderLeft: "3px solid var(--accent)",
            textColor: "var(--text-primary)",
            fillTexture: "diagonal-stripes",
          };
        case "completed":
          return {
            background: "rgba(168, 120, 138, 0.12)",
            borderLeft: "3px solid var(--text-muted)",
            textColor: "var(--text-muted)",
            textTexture: "strikethrough",
          };
        case "cancelled":
          return {
            background: "rgba(168, 120, 138, 0.10)",
            borderLeft: "3px solid var(--text-muted)",
            textColor: "var(--text-muted)",
            textTexture: "strikethrough",
          };
        case "scheduled":
          // Shoots don't carry "scheduled" — fall through to a neutral default
          // rather than throw, so a malformed row can't take down the view.
          return {
            background: "rgba(168, 120, 138, 0.18)",
            borderLeft: "3px solid var(--accent)",
            textColor: "var(--text-primary)",
          };
      }
      break;
    case "sonography":
      return {
        background: "rgba(75, 92, 78, 0.12)",
        borderLeft: "3px solid var(--text-body)",
        textColor: "var(--text-primary)",
      };
    case "work_block":
      return {
        background: "rgba(45, 106, 79, 0.12)",
        borderLeft: "3px solid var(--status-success)",
        textColor: "var(--status-success)",
      };
    case "blocked":
      return {
        background: "rgba(168, 120, 138, 0.08)",
        borderLeft: "3px solid var(--text-muted)",
        textColor: "var(--text-muted)",
        textTexture: "italic",
      };
  }
}

export function stripeBackgroundImage(): string {
  return STRIPES_REQUESTED;
}
