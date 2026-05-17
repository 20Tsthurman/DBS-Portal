"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DashboardCard } from "@/components/ui/DashboardCard";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { AppSettingsRecord } from "@/lib/supabase";
import { updateAppSettingsAction } from "../_actions";

interface AppSettingsSectionProps {
  initial: AppSettingsRecord;
}

type FormState = {
  home_address: string;
  mileage_rate_per_mile: string;
  tax_set_aside_percent: string;
};

function recordToForm(record: AppSettingsRecord): FormState {
  return {
    home_address: record.home_address,
    mileage_rate_per_mile: String(record.mileage_rate_per_mile),
    tax_set_aside_percent: String(record.tax_set_aside_percent),
  };
}

export function AppSettingsSection({ initial }: AppSettingsSectionProps) {
  const [values, setValues] = useState<FormState>(() => recordToForm(initial));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const fadeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const mileageRate = Number(values.mileage_rate_per_mile);
    const taxPercent = Number(values.tax_set_aside_percent);

    if (!Number.isFinite(mileageRate) || mileageRate < 0) {
      setError("Mileage rate must be 0 or greater.");
      return;
    }
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      setError("Tax set-aside must be between 0 and 100.");
      return;
    }

    startTransition(async () => {
      const res = await updateAppSettingsAction({
        home_address: values.home_address,
        mileage_rate_per_mile: mileageRate,
        tax_set_aside_percent: taxPercent,
      });
      if (!res.ok || !res.data) {
        setError(res.error ?? "Save failed.");
        return;
      }
      setValues(recordToForm(res.data));
      setSavedAt(Date.now());
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
      fadeTimerRef.current = window.setTimeout(() => setSavedAt(null), 2000);
    });
  };

  const helperStyle: React.CSSProperties = {
    marginTop: 6,
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  };

  return (
    <DashboardCard eyebrow="BUSINESS" title="Business Settings">
      <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 20 }}>
          <label htmlFor="settings-home-address" style={labelStyle}>
            Home Address
          </label>
          <input
            id="settings-home-address"
            type="text"
            value={values.home_address}
            disabled={isPending}
            onChange={(e) =>
              setValues((v) => ({ ...v, home_address: e.target.value }))
            }
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
            placeholder="123 Main St, Franklin, TN 37067"
            aria-describedby="settings-home-address-help"
          />
          <p id="settings-home-address-help" style={helperStyle}>
            Used as the default origin for mileage suggestions.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="settings-mileage-rate" style={labelStyle}>
            Mileage Rate (per mile)
          </label>
          <input
            id="settings-mileage-rate"
            type="number"
            step="0.01"
            min="0"
            value={values.mileage_rate_per_mile}
            disabled={isPending}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                mileage_rate_per_mile: e.target.value,
              }))
            }
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
            aria-describedby="settings-mileage-rate-help"
          />
          <p id="settings-mileage-rate-help" style={helperStyle}>
            Snapshotted onto each mileage log at write time — changing this
            does not affect existing rows.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="settings-tax-percent" style={labelStyle}>
            Tax Set-Aside (%)
          </label>
          <input
            id="settings-tax-percent"
            type="number"
            step="1"
            min="0"
            max="100"
            value={values.tax_set_aside_percent}
            disabled={isPending}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                tax_set_aside_percent: e.target.value,
              }))
            }
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
            aria-describedby="settings-tax-percent-help"
          />
          <p id="settings-tax-percent-help" style={helperStyle}>
            Applied to net profit. Changing this re-bases historical summaries.
          </p>
        </div>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save Settings"}
          </Button>
          {savedAt !== null && !isPending && (
            <span
              role="status"
              aria-live="polite"
              style={{
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--status-success)",
                fontWeight: 600,
                transition: "opacity 0.4s",
              }}
            >
              Saved.
            </span>
          )}
        </div>
      </form>
    </DashboardCard>
  );
}
