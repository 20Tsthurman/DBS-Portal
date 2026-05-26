"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type {
  ClientStatus,
  ClientType,
  PackageRecord,
} from "@/lib/supabase";
import { SlidePanel } from "./SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "./formStyles";
import { createDraftClientAction } from "../_actions";

export interface ClientInitialValues {
  id?: string;
  name: string;
  email: string;
  type: ClientType;
  status: ClientStatus;
  packageId: string | null;
  /**
   * NULL = draft client (never invited). When NULL, the edit form allows
   * email changes; when set, the email field is locked because the Clerk
   * user's email is the source of truth for sign-in.
   */
  invitedAt?: string | null;
}

interface ClientFormPanelProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  packages: Pick<PackageRecord, "id" | "name" | "tier" | "monthly_price">[];
  initialValues?: ClientInitialValues;
}

const emptyValues: ClientInitialValues = {
  name: "",
  email: "",
  type: "brand",
  status: "onboarding",
  packageId: null,
  invitedAt: null,
};

type SubmitMode = "draft" | "invite" | "edit";

export function ClientFormPanel({
  open,
  onClose,
  mode,
  packages,
  initialValues,
}: ClientFormPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState<ClientInitialValues>(
    initialValues ?? emptyValues
  );
  const [loadingButton, setLoadingButton] = useState<SubmitMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? emptyValues);
      setError(null);
    }
  }, [open, initialValues]);

  const submit = async (submitMode: SubmitMode) => {
    setError(null);

    if (!values.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!values.email.trim() || !values.email.includes("@")) {
      setError("A valid email address is required.");
      return;
    }

    setLoadingButton(submitMode);
    try {
      if (submitMode === "draft") {
        const result = await createDraftClientAction({
          name: values.name.trim(),
          email: values.email.trim(),
          type: values.type,
          packageId: values.packageId,
          status: values.status,
        });
        if (!result.ok) {
          setError(result.error ?? "Failed to save draft.");
          return;
        }
      } else if (submitMode === "invite") {
        const inviteRes = await fetch("/api/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name.trim(),
            email: values.email.trim(),
            type: values.type,
            packageId: values.packageId,
            status: values.status,
          }),
        });
        const inviteData = (await inviteRes.json()) as {
          client?: { id: string };
          error?: string;
          warning?: string;
        };
        if (!inviteRes.ok && inviteRes.status !== 207) {
          setError(inviteData.error ?? "Failed to create client.");
          return;
        }
        const newId = inviteData.client?.id;
        if (newId && values.status !== "onboarding") {
          await fetch(`/api/clients/${newId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: values.status }),
          });
        }
      } else if (submitMode === "edit" && values.id) {
        const res = await fetch(`/api/clients/${values.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name.trim(),
            email: values.email.trim(),
            type: values.type,
            status: values.status,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Failed to update client.");
          return;
        }
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoadingButton(null);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Default form submission (Enter / primary button) goes through the
    // invite flow in add mode, or the PATCH flow in edit mode.
    // "Save as draft" is a type="button" path that calls submit("draft")
    // directly and bypasses this handler.
    submit(mode === "add" ? "invite" : "edit");
  };

  const title = mode === "add" ? "Add Client" : "Edit Client";

  return (
    <SlidePanel open={open} onClose={onClose} title={title}>
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <div>
            <label htmlFor="client-name" style={labelStyle}>
              Full Name
            </label>
            <input
              id="client-name"
              type="text"
              required
              value={values.name}
              onChange={(e) =>
                setValues((v) => ({ ...v, name: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="client-email" style={labelStyle}>
              Email Address
            </label>
            <input
              id="client-email"
              type="email"
              required
              value={values.email}
              onChange={(e) =>
                setValues((v) => ({ ...v, email: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              disabled={mode === "edit" && values.invitedAt != null}
              style={{
                ...fieldStyle,
                opacity:
                  mode === "edit" && values.invitedAt != null ? 0.6 : 1,
                cursor:
                  mode === "edit" && values.invitedAt != null
                    ? "not-allowed"
                    : "text",
              }}
            />
            {mode === "edit" && values.invitedAt != null && (
              <p
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                Email is locked once an invite has been sent.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="client-type" style={labelStyle}>
              Client Type
            </label>
            <select
              id="client-type"
              required
              value={values.type}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  type: e.target.value as ClientType,
                }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              <option value="brand">Brand</option>
              <option value="bride">Bride</option>
            </select>
          </div>

          {mode === "add" && (
            <div>
              <label htmlFor="client-package" style={labelStyle}>
                Package (optional)
              </label>
              <select
                id="client-package"
                value={values.packageId ?? ""}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    packageId: e.target.value || null,
                  }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              >
                <option value="">No package selected</option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} — ${pkg.monthly_price.toLocaleString()}/mo
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="client-status" style={labelStyle}>
              Status
            </label>
            <select
              id="client-status"
              value={values.status}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  status: e.target.value as ClientStatus,
                }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              <option value="lead">Lead</option>
              <option value="onboarding">Onboarding</option>
              <option value="active">Active</option>
              {/*
                "Inactive" is intentionally NOT a user-selectable option here:
                deactivation routes through the dedicated "Deactivate Client"
                button on the detail page so the gravity of the action is
                visible and the Clerk ban fires reliably (see
                app/owner/clients/[id]/_components/DeactivateClientButton.tsx).

                The option is rendered here ONLY when the client is already
                inactive — otherwise the controlled <select> would silently
                coerce the value to the first listed option, losing state.
                Picking active/onboarding/lead from this dropdown for an
                already-inactive client reactivates them via the PATCH
                handler's existing unban branch
                (app/api/clients/[id]/route.ts:160-170).
              */}
              {values.status === "inactive" && (
                <option value="inactive">Inactive</option>
              )}
            </select>
          </div>

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div className="pt-6 flex flex-col gap-3">
          {mode === "add" ? (
            <>
              <Button
                type="submit"
                variant="primary"
                disabled={loadingButton !== null}
                className="w-full"
                style={{ width: "100%" }}
              >
                {loadingButton === "invite" ? "Working…" : "Save & send invite"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => submit("draft")}
                disabled={loadingButton !== null}
                className="w-full"
                style={{ width: "100%" }}
              >
                {loadingButton === "draft" ? "Working…" : "Save as draft"}
              </Button>
            </>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={loadingButton !== null}
              className="w-full"
              style={{ width: "100%" }}
            >
              {loadingButton === "edit" ? "Working…" : "Save Changes"}
            </Button>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}
