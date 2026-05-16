import type { CalendarEvent, EventCategory } from "./types";

export interface EventVisuals {
  background: string;
  borderLeft: string;
  textColor: string;
  textTexture?: "strikethrough" | "italic";
  fillTexture?: "diagonal-stripes" | null;
  /**
   * Category-specific stripe color for the `diagonal-stripes` texture. Lets
   * a requested meeting stripe in mauve-blue instead of the shoot mauve.
   * Callers pass this back into `stripeBackgroundImage(stripeColor)`.
   */
  stripeColor?: string;
}

const SHOOT_STRIPE_COLOR = "rgba(168, 120, 138, 0.18)";
const MEETING_STRIPE_COLOR = "rgba(120, 130, 168, 0.18)";

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
            stripeColor: SHOOT_STRIPE_COLOR,
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
    case "meeting":
      // Same family as shoot (shares the lifecycle and lives in the same
      // table) but rendered in a cooler mauve-blue so it reads as related
      // but distinct at a glance.
      switch (event.status) {
        case "confirmed":
          return {
            background: "rgba(120, 130, 168, 0.18)",
            borderLeft: "3px solid rgba(120, 130, 168, 1)",
            textColor: "#3d4868",
          };
        case "requested":
          return {
            background: "rgba(120, 130, 168, 0.18)",
            borderLeft: "3px solid rgba(120, 130, 168, 1)",
            textColor: "#3d4868",
            fillTexture: "diagonal-stripes",
            stripeColor: MEETING_STRIPE_COLOR,
          };
        case "completed":
          return {
            background: "rgba(120, 130, 168, 0.12)",
            borderLeft: "3px solid var(--text-muted)",
            textColor: "var(--text-muted)",
            textTexture: "strikethrough",
          };
        case "cancelled":
          return {
            background: "rgba(120, 130, 168, 0.10)",
            borderLeft: "3px solid var(--text-muted)",
            textColor: "var(--text-muted)",
            textTexture: "strikethrough",
          };
        case "scheduled":
          return {
            background: "rgba(120, 130, 168, 0.18)",
            borderLeft: "3px solid rgba(120, 130, 168, 1)",
            textColor: "#3d4868",
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

export function stripeBackgroundImage(
  color: string = SHOOT_STRIPE_COLOR
): string {
  return `repeating-linear-gradient(45deg, transparent 0, transparent 4px, ${color} 4px, ${color} 8px)`;
}

/**
 * Friendly category label for display contexts that need plain text
 * (badges, day-panel category tags). Kept here so the shoot/meeting
 * split has one canonical naming source.
 */
export function categoryLabel(category: EventCategory): string {
  switch (category) {
    case "shoot":
      return "Shoot";
    case "meeting":
      return "Meeting";
    case "sonography":
      return "Sonography";
    case "work_block":
      return "Work block";
    case "blocked":
      return "Blocked";
  }
}
