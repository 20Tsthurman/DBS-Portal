"use client";

import { useState, type ReactNode } from "react";

export type TabKey =
  | "overview"
  | "time"
  | "messages"
  | "files"
  | "invoices"
  | "notes";

export interface TabDefinition {
  key: TabKey;
  label: string;
  content: ReactNode;
}

interface TabNavProps {
  tabs: TabDefinition[];
  initial?: TabKey;
}

export function TabNav({ tabs, initial }: TabNavProps) {
  const [active, setActive] = useState<TabKey>(initial ?? tabs[0]?.key);

  return (
    <div>
      <div
        className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ borderColor: "var(--border)" }}
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.key)}
              className="flex-shrink-0 min-h-[44px]"
              style={{
                padding: "12px 16px",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                background: "transparent",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                cursor: "pointer",
                marginBottom: "-1px",
                transition: "color 120ms ease-out",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--text-body)";
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="pt-8">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            role="tabpanel"
            hidden={tab.key !== active}
            aria-hidden={tab.key !== active}
          >
            {tab.key === active ? tab.content : null}
          </div>
        ))}
      </div>
    </div>
  );
}
