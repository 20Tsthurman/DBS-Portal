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

export interface ClientInitialValues {
  id?: string;
  name: string;
  email: string;
  type: ClientType;
  status: ClientStatus;
  packageId: string | null;
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
};

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? emptyValues);
      setError(null);
    }
  }, [open, initialValues]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!values.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!values.email.trim() || !values.email.includes("@")) {
      setError("A valid email address is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "add") {
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
      } else if (mode === "edit" && values.id) {
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
      setSubmitting(false);
    }
  };

  const title = mode === "add" ? "Add Client" : "Edit Client";
  const submitLabel = mode === "add" ? "Send Invite" : "Save Changes";

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
              disabled={mode === "edit"}
              style={{
                ...fieldStyle,
                opacity: mode === "edit" ? 0.6 : 1,
                cursor: mode === "edit" ? "not-allowed" : "text",
              }}
            />
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
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div className="pt-6">
          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
            style={{ width: "100%" }}
          >
            {submitting ? "Working…" : submitLabel}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}
