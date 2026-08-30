"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import {
  applyFocus,
  clearFocus,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import { contentHref, type ContentView } from "../_lib/href";
import type { ContentClientOption } from "../_lib/queries";

interface ClientFilterSelectProps {
  /** Already alphabetized by `fetchContentClients`. */
  clients: ContentClientOption[];
  /** null = "All clients". */
  activeClientId: string | null;
  monthKey: string;
  view: ContentView;
}

const SELECT_ID = "content-client-filter";

/**
 * Client filter as a single dropdown — the pill row it replaced worked at
 * five clients and broke down at thirty. Navigation, not form state:
 * changing the value pushes the same `contentHref` URL the pills linked to,
 * preserving month and view.
 *
 * On mobile it drops out of the toolbar row (`order-last w-full`) into a
 * full-width control below the month stepper and view toggle.
 */
export function ClientFilterSelect({
  clients,
  activeClientId,
  monthKey,
  view,
}: ClientFilterSelectProps) {
  const router = useRouter();

  return (
    <div
      className="order-last flex w-full items-center sm:order-none sm:w-auto"
      style={wrapStyle}
    >
      <label htmlFor={SELECT_ID} style={filterLabelStyle}>
        Filter by client
      </label>
      <select
        id={SELECT_ID}
        value={activeClientId ?? ""}
        onChange={(e) =>
          router.push(
            contentHref({
              monthKey,
              clientId: e.target.value || null,
              view,
            })
          )
        }
        onFocus={applyFocus}
        onBlur={clearFocus}
        className="min-w-0 flex-1 sm:flex-none sm:w-56"
        style={selectStyle}
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  gap: 12,
  marginBottom: 16,
};

const filterLabelStyle: CSSProperties = {
  ...labelStyle,
  marginBottom: 0,
  whiteSpace: "nowrap",
};

// Width lives in the responsive classes on the element — an inline width
// would override them.
const selectStyle: CSSProperties = {
  ...fieldStyle,
  width: undefined,
};
