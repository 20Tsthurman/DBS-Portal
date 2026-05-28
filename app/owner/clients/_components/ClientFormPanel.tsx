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
import {
  createClientAction,
  updateProjectPricingAction,
} from "../_actions";

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
  monthlyPriceOverride?: number | null;
  monthlyHoursOverride?: number | null;
}

interface ClientFormPanelProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  packages: Pick<
    PackageRecord,
    "id" | "name" | "tier" | "monthly_price" | "monthly_hours"
  >[];
  initialValues?: ClientInitialValues;
}

const emptyValues: ClientInitialValues = {
  name: "",
  email: "",
  type: "brand",
  status: "onboarding",
  packageId: null,
  invitedAt: null,
  monthlyPriceOverride: null,
  monthlyHoursOverride: null,
};

type SubmitMode = "create" | "edit";

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
  // Opt-in invite. Stays false across re-opens so an accidental click on a
  // previously-checked panel can't quietly fire another invite email.
  const [sendInvite, setSendInvite] = useState(false);

  // Custom-pricing UI state (edit mode only). Inputs are kept as strings so
  // mid-typing ("2." / "") doesn't get rewritten by Number() coercion. Parsed
  // on submit.
  const initialCustomOn =
    (initialValues?.monthlyPriceOverride ?? null) !== null ||
    (initialValues?.monthlyHoursOverride ?? null) !== null;
  const [customPricingOn, setCustomPricingOn] = useState(initialCustomOn);
  const [priceInput, setPriceInput] = useState(
    initialValues?.monthlyPriceOverride != null
      ? String(initialValues.monthlyPriceOverride)
      : ""
  );
  const [hoursInput, setHoursInput] = useState(
    initialValues?.monthlyHoursOverride != null
      ? String(initialValues.monthlyHoursOverride)
      : ""
  );

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? emptyValues);
      setError(null);
      setSendInvite(false);
      const customOn =
        (initialValues?.monthlyPriceOverride ?? null) !== null ||
        (initialValues?.monthlyHoursOverride ?? null) !== null;
      setCustomPricingOn(customOn);
      setPriceInput(
        initialValues?.monthlyPriceOverride != null
          ? String(initialValues.monthlyPriceOverride)
          : ""
      );
      setHoursInput(
        initialValues?.monthlyHoursOverride != null
          ? String(initialValues.monthlyHoursOverride)
          : ""
      );
    }
  }, [open, initialValues]);

  // Package default lookup for placeholders. In edit mode the package picker
  // is hidden, so `values.packageId` only changes from initialValues.
  const selectedPackage = values.packageId
    ? packages.find((p) => p.id === values.packageId)
    : undefined;

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
      if (submitMode === "create") {
        // Status is auto-derived from the invite checkbox: checked clients
        // jump straight to 'onboarding' to match the existing invite flow,
        // unchecked clients land as 'lead' for Kelsey to advance manually
        // from the detail page.
        const derivedStatus: ClientStatus = sendInvite ? "onboarding" : "lead";
        const result = await createClientAction({
          name: values.name.trim(),
          email: values.email.trim(),
          type: values.type,
          packageId: values.packageId,
          status: derivedStatus,
          sendInvite,
        });
        if (!result.ok) {
          setError(result.error ?? "Failed to save client.");
          return;
        }
      } else if (submitMode === "edit" && values.id) {
        // Parse and validate the custom-pricing inputs BEFORE writing anything.
        // Toggle off => both nulls (clears prior overrides on server). Toggle
        // on => blank input = null, otherwise parse and validate >= 0.
        let priceOverride: number | null = null;
        let hoursOverride: number | null = null;
        if (customPricingOn) {
          if (priceInput.trim() !== "") {
            const n = Number(priceInput);
            if (!Number.isFinite(n) || n < 0) {
              setError("Monthly price override must be a non-negative number.");
              return;
            }
            priceOverride = n;
          }
          if (hoursInput.trim() !== "") {
            const n = Number(hoursInput);
            if (!Number.isFinite(n) || n < 0) {
              setError("Monthly hours override must be a non-negative number.");
              return;
            }
            hoursOverride = n;
          }
        }

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

        const pricingRes = await updateProjectPricingAction({
          clientId: values.id,
          monthlyPriceOverride: priceOverride,
          monthlyHoursOverride: hoursOverride,
        });
        if (!pricingRes.ok) {
          setError(pricingRes.error ?? "Failed to save custom pricing.");
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
    if (mode === "edit") {
      submit("edit");
      return;
    }
    // Add mode: gate the invite path behind a window.confirm so an
    // accidental Enter / button click can't silently fire a Clerk + Resend
    // email. The unchecked path saves the client as a lead with no portal
    // access — fully reversible from the detail page.
    if (sendInvite) {
      const trimmedEmail = values.email.trim();
      const ok = window.confirm(
        `Send a portal invite email to ${trimmedEmail}? They'll receive a link to set up their account.`
      );
      if (!ok) return;
    }
    submit("create");
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

          {mode === "edit" && (
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
          )}

          {mode === "edit" && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 20,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  color: "var(--text-primary)",
                  fontWeight: 500,
                }}
              >
                <input
                  type="checkbox"
                  checked={customPricingOn}
                  onChange={(e) => setCustomPricingOn(e.target.checked)}
                />
                This client has custom pricing
              </label>

              {customPricingOn && (
                <div style={{ marginTop: 16 }} className="space-y-4">
                  <div>
                    <label htmlFor="client-price-override" style={labelStyle}>
                      Monthly price override
                    </label>
                    <input
                      id="client-price-override"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      onFocus={applyFocus}
                      onBlur={clearFocus}
                      placeholder={
                        selectedPackage
                          ? `Default: $${Number(selectedPackage.monthly_price).toLocaleString()}`
                          : "e.g. 2000"
                      }
                      style={fieldStyle}
                    />
                    <p
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      Leave blank to use the package default.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="client-hours-override" style={labelStyle}>
                      Monthly hours override
                    </label>
                    <input
                      id="client-hours-override"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.5"
                      value={hoursInput}
                      onChange={(e) => setHoursInput(e.target.value)}
                      onFocus={applyFocus}
                      onBlur={clearFocus}
                      placeholder={
                        selectedPackage
                          ? `Default: ${Number(selectedPackage.monthly_hours)} hrs/mo`
                          : "e.g. 24"
                      }
                      style={fieldStyle}
                    />
                    <p
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      Leave blank to use the package default.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        {mode === "add" && (
          <div
            style={{
              marginTop: 24,
              borderTop: "1px solid var(--border)",
              paddingTop: 24,
            }}
          >
            <div style={labelStyle}>Portal Access</div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: 14,
                color: "var(--text-primary)",
              }}
            >
              <input
                type="checkbox"
                checked={sendInvite}
                onChange={(e) => setSendInvite(e.target.checked)}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 0,
                  accentColor: "var(--accent)",
                  cursor: "pointer",
                }}
              />
              Send portal invite when saving
            </label>
            <p
              style={{
                marginTop: 4,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              They&apos;ll receive an email with a link to set up their
              account. You can also invite them later from the client&apos;s
              page.
            </p>
          </div>
        )}

        <div className="pt-6 flex flex-col gap-3">
          {mode === "add" ? (
            <Button
              type="submit"
              variant="primary"
              disabled={loadingButton !== null}
              className="w-full"
              style={{ width: "100%" }}
            >
              {loadingButton === "create"
                ? "Working…"
                : sendInvite
                  ? "Save & send invite"
                  : "Save client"}
            </Button>
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
