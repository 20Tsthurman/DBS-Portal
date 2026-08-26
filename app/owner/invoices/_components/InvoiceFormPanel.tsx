"use client";

import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { IncomeType } from "@/lib/supabase";
import {
  createInvoiceAction,
  sendInvoiceAction,
  updateInvoiceAction,
} from "../_actions";
import {
  formatInvoiceAmount,
  INCOME_TYPE_LABELS,
} from "../_lib/format";
import type {
  ClientPickerOption,
  InvoiceWithClient,
} from "../_lib/queries";

interface InvoiceFormPanelProps {
  open: boolean;
  onClose: () => void;
  /** Present = edit/view mode. Absent = create mode. */
  invoice?: InvoiceWithClient | null;
  clients: ClientPickerOption[];
  defaultClientId?: string;
  defaultSendImmediately?: boolean;
}

interface LineItemDraft {
  description: string;
  amount: string;
}

interface FormValues {
  clientId: string;
  incomeType: IncomeType;
  lineItems: LineItemDraft[];
  dueDate: string;
  memo: string;
  sendImmediately: boolean;
}

const emptyLineItem = (): LineItemDraft => ({ description: "", amount: "" });

const emptyValues: FormValues = {
  clientId: "",
  incomeType: "other",
  lineItems: [emptyLineItem()],
  dueDate: "",
  memo: "",
  sendImmediately: false,
};

const INCOME_TYPES: IncomeType[] = [
  "brand_retainer",
  "wedding_same_day",
  "one_off_shoot",
  "other",
];

function valuesFromInvoice(invoice: InvoiceWithClient): FormValues {
  return {
    clientId: invoice.client_id,
    incomeType: invoice.income_type,
    lineItems:
      invoice.line_items.length > 0
        ? invoice.line_items.map((li) => ({
            description: li.description,
            amount: String(li.amount),
          }))
        : [emptyLineItem()],
    dueDate: invoice.due_date ?? "",
    memo: invoice.memo ?? "",
    sendImmediately: false,
  };
}

export function InvoiceFormPanel({
  open,
  onClose,
  invoice,
  clients,
  defaultClientId,
  defaultSendImmediately,
}: InvoiceFormPanelProps) {
  const router = useRouter();
  const fieldId = useId();

  const isEdit = Boolean(invoice);
  // Read-only whenever the invoice can no longer legally change: it's
  // paid (money is on the books) or it's been marked Inactive (the
  // server rejects edits until it's reactivated). Both open the panel as
  // a viewer.
  const isReadOnly =
    invoice?.status === "paid" || invoice?.inactive_at != null;
  // The send-immediately toggle only makes sense for new drafts and
  // existing drafts. Once an invoice is sent, the only action is "save
  // changes" (PDF regen is automatic).
  const canSendImmediately =
    !invoice || (invoice.status === "draft" && !invoice.inactive_at);

  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setValues(valuesFromInvoice(invoice));
    } else {
      setValues({
        ...emptyValues,
        clientId: defaultClientId ?? "",
        sendImmediately: defaultSendImmediately ?? false,
        lineItems: [emptyLineItem()],
      });
    }
    setError(null);
    setConfirmOpen(false);
  }, [open, invoice, defaultClientId, defaultSendImmediately]);

  const selectedClient = clients.find((c) => c.id === values.clientId) ?? null;

  const computedTotal = values.lineItems.reduce((sum, item) => {
    const n = Number(item.amount);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);

  const addLineItem = () => {
    if (values.lineItems.length >= 20) return;
    setValues((v) => ({ ...v, lineItems: [...v.lineItems, emptyLineItem()] }));
  };

  const removeLineItem = (idx: number) => {
    setValues((v) => ({
      ...v,
      lineItems:
        v.lineItems.length <= 1
          ? v.lineItems
          : v.lineItems.filter((_, i) => i !== idx),
    }));
  };

  const updateLineItem = (
    idx: number,
    patch: Partial<LineItemDraft>
  ) => {
    setValues((v) => ({
      ...v,
      lineItems: v.lineItems.map((item, i) =>
        i === idx ? { ...item, ...patch } : item
      ),
    }));
  };

  function validate(): {
    ok: true;
    payload: {
      clientId: string;
      lineItems: Array<{ description: string; amount: number }>;
      dueDate: string | null;
      memo: string | null;
      incomeType: IncomeType;
    };
  } | { ok: false; error: string } {
    if (!values.clientId) {
      return { ok: false, error: "Please pick a client." };
    }
    if (!INCOME_TYPES.includes(values.incomeType)) {
      return { ok: false, error: "Please pick an income type." };
    }
    const items: Array<{ description: string; amount: number }> = [];
    for (const li of values.lineItems) {
      const description = li.description.trim();
      if (!description) {
        return { ok: false, error: "Each line item needs a description." };
      }
      const amount = Number(li.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return {
          ok: false,
          error: "Each line item amount must be greater than 0.",
        };
      }
      items.push({ description, amount });
    }
    if (items.length === 0) {
      return { ok: false, error: "Add at least one line item." };
    }
    if (items.length > 20) {
      return { ok: false, error: "At most 20 line items allowed." };
    }
    const dueDate = values.dueDate.trim() || null;
    const memo = values.memo.trim() || null;
    return {
      ok: true,
      payload: {
        clientId: values.clientId,
        lineItems: items,
        dueDate,
        memo,
        incomeType: values.incomeType,
      },
    };
  }

  const performSave = async () => {
    const validated = validate();
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let resultInvoiceId: string | null = invoice?.id ?? null;
      if (invoice) {
        const res = await updateInvoiceAction({
          invoiceId: invoice.id,
          lineItems: validated.payload.lineItems,
          dueDate: validated.payload.dueDate,
          memo: validated.payload.memo,
          incomeType: validated.payload.incomeType,
        });
        if (!res.ok) {
          setError(res.error ?? "Failed to save invoice.");
          return;
        }
      } else {
        const res = await createInvoiceAction(validated.payload);
        if (!res.ok || !res.data) {
          setError(res.error ?? "Failed to create invoice.");
          return;
        }
        resultInvoiceId = res.data.id;
      }

      if (values.sendImmediately && canSendImmediately && resultInvoiceId) {
        const sendRes = await sendInvoiceAction({ invoiceId: resultInvoiceId });
        if (!sendRes.ok) {
          setError(sendRes.error ?? "Saved, but could not send.");
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (values.sendImmediately && canSendImmediately) {
      // Pre-flight: validate before opening the confirm dialog so we
      // don't ask the user to confirm sending an invalid invoice.
      const validated = validate();
      if (!validated.ok) {
        setError(validated.error);
        return;
      }
      setConfirmOpen(true);
      return;
    }
    void performSave();
  };

  const handleConfirmSend = async () => {
    setConfirmOpen(false);
    await performSave();
  };

  const title = invoice
    ? isReadOnly
      ? `Invoice ${invoice.invoice_number ?? ""}`
      : `Edit Invoice ${invoice.invoice_number ?? ""}`
    : "New Invoice";

  let submitLabel = "Save draft";
  if (invoice) {
    submitLabel = "Save changes";
  } else if (values.sendImmediately) {
    submitLabel = "Send invoice";
  }

  // Disable client picker on edit — reassignment would orphan the
  // generated PDF stored under the original client's storage path.
  const clientPickerDisabled = isEdit || isReadOnly;

  return (
    <>
      <SlidePanel
        open={open}
        onClose={submitting ? () => {} : onClose}
        title={title}
        widthPx={520}
      >
        <form
          onSubmit={handleSubmit}
          className="flex h-full flex-col"
          style={{ minHeight: 0 }}
        >
          <div className="flex-1 space-y-5">
            <div>
              <label htmlFor={`${fieldId}-client`} style={labelStyle}>
                Client
              </label>
              <select
                id={`${fieldId}-client`}
                required
                value={values.clientId}
                disabled={clientPickerDisabled}
                onChange={(e) =>
                  setValues((v) => ({ ...v, clientId: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${fieldId}-income`} style={labelStyle}>
                Income type
              </label>
              <select
                id={`${fieldId}-income`}
                required
                value={values.incomeType}
                disabled={isReadOnly}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    incomeType: e.target.value as IncomeType,
                  }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              >
                {INCOME_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INCOME_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span style={labelStyle}>Line items</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {values.lineItems.map((item, idx) => (
                  <div
                    key={`li-${idx}`}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "stretch",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Description"
                      value={item.description}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        updateLineItem(idx, { description: e.target.value })
                      }
                      onFocus={applyFocus}
                      onBlur={clearFocus}
                      // minWidth: 0 lets this shrink inside the no-wrap line-item
                      // row; without it the input's intrinsic min-content width
                      // (which grew with the 16px bump) pushes the row past the
                      // panel edge.
                      style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={item.amount}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        updateLineItem(idx, { amount: e.target.value })
                      }
                      onFocus={applyFocus}
                      onBlur={clearFocus}
                      style={{
                        ...fieldStyle,
                        width: 110,
                        textAlign: "right",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeLineItem(idx)}
                      disabled={isReadOnly || values.lineItems.length <= 1}
                      aria-label="Remove line item"
                      style={removeButtonStyle(
                        isReadOnly || values.lineItems.length <= 1
                      )}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={addLineItem}
                  disabled={values.lineItems.length >= 20}
                  style={{
                    ...addLineButtonStyle,
                    opacity: values.lineItems.length >= 20 ? 0.5 : 1,
                    cursor:
                      values.lineItems.length >= 20 ? "not-allowed" : "pointer",
                  }}
                >
                  + Add line item
                </button>
              )}
            </div>

            <div>
              <label htmlFor={`${fieldId}-due`} style={labelStyle}>
                Due date <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id={`${fieldId}-due`}
                type="date"
                value={values.dueDate}
                disabled={isReadOnly}
                onChange={(e) =>
                  setValues((v) => ({ ...v, dueDate: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              />
            </div>

            <div>
              <label htmlFor={`${fieldId}-memo`} style={labelStyle}>
                Memo <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <textarea
                id={`${fieldId}-memo`}
                rows={3}
                value={values.memo}
                disabled={isReadOnly}
                onChange={(e) =>
                  setValues((v) => ({ ...v, memo: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </div>

            {canSendImmediately && !isReadOnly && (
              <label
                htmlFor={`${fieldId}-send`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  backgroundColor: values.sendImmediately
                    ? "rgba(168, 120, 138, 0.08)"
                    : "transparent",
                }}
              >
                <input
                  id={`${fieldId}-send`}
                  type="checkbox"
                  checked={values.sendImmediately}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      sendImmediately: e.target.checked,
                    }))
                  }
                />
                <span style={{ fontSize: 13, color: "var(--text-body)" }}>
                  Send to client now (otherwise saves as draft)
                </span>
              </label>
            )}

            <div style={totalRowStyle}>
              <span style={totalLabelStyle}>Total</span>
              <span style={totalAmountStyle}>
                {formatInvoiceAmount(computedTotal)}
              </span>
            </div>

            {error && <div style={errorStyle}>{error}</div>}
          </div>

          <div
            style={{
              paddingTop: 24,
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                ...cancelButtonStyle,
                opacity: submitting ? 0.6 : 1,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {isReadOnly ? "Close" : "Cancel"}
            </button>
            {!isReadOnly && (
              <Button
                type="submit"
                disabled={submitting}
                style={{ minWidth: 140 }}
              >
                {submitting ? "Saving…" : submitLabel}
              </Button>
            )}
          </div>
        </form>
      </SlidePanel>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSend}
        title="Send invoice?"
        body={
          <>
            Send invoice
            {invoice?.invoice_number ? ` ${invoice.invoice_number}` : ""} to{" "}
            <strong>{selectedClient?.name ?? "this client"}</strong> now?
            This will generate the PDF and email it.
          </>
        }
        confirmLabel="Send invoice"
        variant="default"
        busy={submitting}
      />
    </>
  );
}

const totalRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 0",
  borderTop: "1px solid var(--border)",
  borderBottom: "1px solid var(--border)",
};

const totalLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-body)",
};

const totalAmountStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "var(--text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const addLineButtonStyle: CSSProperties = {
  marginTop: 8,
  background: "transparent",
  border: "1px dashed var(--border)",
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--accent)",
};

function removeButtonStyle(disabled: boolean): CSSProperties {
  return {
    width: 32,
    background: "transparent",
    border: "1px solid var(--border)",
    color: disabled ? "var(--text-muted)" : "var(--status-danger)",
    fontSize: 18,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

const cancelButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "transparent",
  color: "var(--text-body)",
  border: "1px solid var(--border)",
  fontFamily: "inherit",
};
