"use client";

import type {
  AppSettingsRecord,
  RecurringExpenseTemplateRecord,
} from "@/lib/supabase";
import { AppSettingsSection } from "./AppSettingsSection";
import { TemplatesTableSection } from "./TemplatesTableSection";

interface SettingsBoardProps {
  initialSettings: AppSettingsRecord;
  initialTemplates: RecurringExpenseTemplateRecord[];
}

export function SettingsBoard({
  initialSettings,
  initialTemplates,
}: SettingsBoardProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <AppSettingsSection initial={initialSettings} />
      <TemplatesTableSection initial={initialTemplates} />

      {/*
        Cell + row styles shared with the financials board. Duplicated rather
        than hoisted to globals.css to keep the surface area of the global
        stylesheet small; both surfaces remain visually consistent because
        they target the same design tokens.
      */}
      <style>{`
        .st-row:hover td { background-color: var(--surface-base); }
        .st-row-saving { opacity: 0.85; pointer-events: none; }
        .st-row-inactive td { opacity: 0.6; }
        .st-cell-display {
          border-color: transparent;
          transition: border-color 0.1s;
        }
        .st-cell-display:hover { border-color: var(--border); }
        .st-cell-display:focus { border-color: var(--accent); outline: none; }
        .st-cell-display.fb-cell-error { border-color: var(--status-danger); }
        .st-cell-display.fb-cell-error:hover { border-color: var(--status-danger); }
        .st-cell-display-empty {
          font-style: italic;
          color: var(--text-muted);
        }

        .st-row-delete {
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.1s, color 0.1s;
        }
        .st-row:hover .st-row-delete { opacity: 1; }
        .st-row-delete:focus { opacity: 1; outline: none; color: var(--status-danger); }
        .st-row-delete:hover { color: var(--status-danger); }
        @media (hover: none) {
          .st-row-delete { opacity: 1; }
        }

        /*
          InlineCell looks for the financials' class names. Mirror them onto
          our row scope so the same component re-skins cleanly here.
        */
        .st-row .fb-cell-display { border-color: transparent; transition: border-color 0.1s; }
        .st-row .fb-cell-display:hover { border-color: var(--border); }
        .st-row .fb-cell-display:focus { border-color: var(--accent); outline: none; }
        .st-row .fb-cell-display.fb-cell-error { border-color: var(--status-danger); }
        .st-row .fb-cell-display-empty { font-style: italic; color: var(--text-muted); }

        .st-active-checkbox {
          width: 18px;
          height: 18px;
          accent-color: var(--accent);
          cursor: pointer;
        }
        .st-active-checkbox:disabled { cursor: not-allowed; opacity: 0.5; }
      `}</style>
    </div>
  );
}
