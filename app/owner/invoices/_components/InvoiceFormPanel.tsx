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
  fieldErrorStyle,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { IncomeType } from "@/lib/supabase";
import { formatChargeAmount } from "@/lib/revisionBilling";
import {
  createInvoiceAction,
  fetchInvoiceRevisionChargesAction,
  sendInvoiceAction,
  updateInvoiceAction,
  type InvoiceRevisionCharges,
} from "../_actions";
import type { RevisionChargeOption } from "../_lib/revisionChargeLines";
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
  /**
   * Set on a line added from the revision charges picker (Content &
   * Approval, Phase 8): the charge's round ids, sent to the server, which
   * rebuilds the description and amount from the charge and stamps these
   * rounds to the invoice. Such a line is read-only here — its text is a
   * copy-deck string and its amount is what the client consented to — and
   * removing it returns the charge to the picker.
   */
  revisionRoundIds?: string[];
  /** The charge's key, for the picker's "already added" check. */
  revisionChargeKey?: string;
}

type ChargesStatus = "idle" | "loading" | "ready" | "failed";

/**
 * Tag the line items that carry this invoice's attached charges. The server
 * rebuilt those lines from the charge on the last save, so an attached
 * charge's description and amount match its line exactly; the first untagged
 * match is tagged. An attached charge with no matching line (a description
 * that changed between versions) is appended as a tagged line rather than
 * dropped — dropping it would clear its stamp on the next save and put a
 * charge that is on this invoice back into the pool.
 */
function tagAttachedCharges(
  lineItems: LineItemDraft[],
  attached: RevisionChargeOption[]
): LineItemDraft[] {
  const next = lineItems.map((li) => ({ ...li }));
  for (const option of attached) {
    if (next.some((li) => li.revisionChargeKey === option.key)) continue;
    const match = next.find(
      (li) =>
        !li.revisionRoundIds &&
        li.description === option.description &&
        Number(li.amount) === option.amount
    );
    if (match) {
      match.revisionRoundIds = option.roundIds;
      match.revisionChargeKey = option.key;
    } else {
      next.push({
        description: option.description,
        amount: String(option.amount),
        revisionRoundIds: option.roundIds,
        revisionChargeKey: option.key,
      });
    }
  }
  return next;
}

/** A single untouched default row — what "no line items yet" looks like. */
function isBlankOnlyRow(lineItems: LineItemDraft[]): boolean {
  return (
    lineItems.length === 1 &&
    !lineItems[0].revisionRoundIds &&
    lineItems[0].description.trim() === "" &&
    lineItems[0].amount.trim() === ""
  );
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
  // The client's accrued revision charges, fetched on open and on client
  // change (Phase 8). `savedWarning` is the one partial state a create can
  // leave — invoice created, charges not stamped — shown in place of the
  // form so a second Save cannot create a second invoice.
  const [charges, setCharges] = useState<InvoiceRevisionCharges | null>(null);
  const [chargesStatus, setChargesStatus] = useState<ChargesStatus>("idle");
  const [chargesReload, setChargesReload] = useState(0);
  const [savedWarning, setSavedWarning] = useState<string | null>(null);

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
    setSavedWarning(null);
  }, [open, invoice, defaultClientId, defaultSendImmediately]);

  // Whose charges to show: the invoice's client in edit mode, the picker's
  // choice on create. On create, a change of client also drops any charge
  // lines the previous client left behind — they are not this client's.
  const chargeClientId = invoice ? invoice.client_id : values.clientId;
  const chargeInvoiceId = invoice?.id ?? null;

  useEffect(() => {
    if (!open) return;
    if (!chargeClientId) {
      setCharges(null);
      setChargesStatus("idle");
      return;
    }
    let cancelled = false;
    setChargesStatus("loading");
    setValues((v) => ({
      ...v,
      lineItems: v.lineItems.some((li) => li.revisionRoundIds)
        ? v.lineItems.filter((li) => !li.revisionRoundIds)
        : v.lineItems,
    }));
    void fetchInvoiceRevisionChargesAction({
      clientId: chargeClientId,
      invoiceId: chargeInvoiceId,
    }).then((res) => {
      if (cancelled) return;
      if (!res.ok || !res.data) {
        setCharges(null);
        setChargesStatus("failed");
        return;
      }
      const data = res.data;
      setCharges(data);
      setChargesStatus("ready");
      if (data.attached.length > 0) {
        setValues((v) => {
          const tagged = tagAttachedCharges(
            v.lineItems.length === 0 ? [] : v.lineItems,
            data.attached
          );
          return { ...v, lineItems: tagged.length > 0 ? tagged : [emptyLineItem()] };
        });
      } else {
        setValues((v) => ({
          ...v,
          lineItems: v.lineItems.length > 0 ? v.lineItems : [emptyLineItem()],
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, chargeClientId, chargeInvoiceId, chargesReload]);

  const selectedClient = clients.find((c) => c.id === values.clientId) ?? null;

  // Charges that are ready, unclaimed, and not yet on this form.
  const availableCharges = (charges?.available ?? []).filter(
    (option) =>
      !values.lineItems.some((li) => li.revisionChargeKey === option.key)
  );

  const addCharge = (option: RevisionChargeOption) => {
    setValues((v) => {
      const base = isBlankOnlyRow(v.lineItems) ? [] : v.lineItems;
      if (base.length >= 20) return v;
      if (base.some((li) => li.revisionChargeKey === option.key)) return v;
      return {
        ...v,
        lineItems: [
          ...base,
          {
            description: option.description,
            amount: String(option.amount),
            revisionRoundIds: option.roundIds,
            revisionChargeKey: option.key,
          },
        ],
      };
    });
  };

  // In edit mode the form must not save until the attached charges are known
  // and tagged: saving over an unknown set would clear every stamp on the
  // invoice (the sync is set-based) while the lines stayed, and put charges
  // that are on this invoice back into the pool. On create there are no
  // stamps to protect, so a failed load only hides the picker.
  const chargesBlocked =
    isEdit && !isReadOnly && chargesStatus !== "ready";

  const computedTotal = values.lineItems.reduce((sum, item) => {
    const n = Number(item.amount);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);

  const addLineItem = () => {
    if (values.lineItems.length >= 20) return;
    setValues((v) => ({ ...v, lineItems: [...v.lineItems, emptyLineItem()] }));
  };

  const removeLineItem = (idx: number) => {
    setValues((v) => {
      // The only row: a charge line is replaced by a blank row (it goes back
      // to the picker); a manual row stays, as before.
      if (v.lineItems.length <= 1) {
        return v.lineItems[0]?.revisionRoundIds
          ? { ...v, lineItems: [emptyLineItem()] }
          : v;
      }
      return { ...v, lineItems: v.lineItems.filter((_, i) => i !== idx) };
    });
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
      lineItems: Array<{
        description: string;
        amount: number;
        revisionRoundIds?: string[];
      }>;
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
    const items: Array<{
      description: string;
      amount: number;
      revisionRoundIds?: string[];
    }> = [];
    for (const li of values.lineItems) {
      if (li.revisionRoundIds && li.revisionRoundIds.length > 0) {
        // A charge line: the server rebuilds its text and amount from the
        // charge, so only the round ids matter here.
        items.push({
          description: li.description,
          amount: Number(li.amount),
          revisionRoundIds: li.revisionRoundIds,
        });
        continue;
      }
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
        if (res.data.revisionChargeWarning) {
          // Created, but the charges were not stamped. Freeze the form on
          // the warning — a second Save would create a second invoice — and
          // skip any send: an invoice whose charges could be re-billed should
          // not go out until she has looked at it.
          setSavedWarning(
            values.sendImmediately && canSendImmediately
              ? `${res.data.revisionChargeWarning} It was saved as a draft and not sent.`
              : res.data.revisionChargeWarning
          );
          router.refresh();
          return;
        }
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
        {savedWarning !== null ? (
          // The frozen state: the invoice exists, its revision charges do
          // not carry its stamp. Nothing here is a Save.
          <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
            <div className="flex-1">
              <div role="alert" style={warningStyle}>
                {savedWarning}
              </div>
            </div>
            <div style={{ paddingTop: 24, display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} style={cancelButtonStyle}>
                Close
              </button>
            </div>
          </div>
        ) : (
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

            {/* Accrued revision charges (Content & Approval, Phase 8). Only
                ready, unclaimed charges are offered; adding one appends a
                read-only line at the amount the client consented to, and the
                server stamps the charge's rounds to this invoice on save.
                Absent entirely when there is nothing to offer, so an ordinary
                invoice never sees an empty block. */}
            {chargeClientId &&
              !isReadOnly &&
              (chargesStatus === "loading" ||
                chargesStatus === "failed" ||
                availableCharges.length > 0) && (
                <div>
                  <span style={labelStyle}>Revision charges</span>
                  {chargesStatus === "loading" && (
                    <p style={helperStyle}>Checking for revision charges…</p>
                  )}
                  {chargesStatus === "failed" && (
                    <div>
                      <p style={fieldErrorStyle}>
                        Couldn&apos;t load this client&apos;s revision charges.
                        {isEdit ? " The invoice can't be saved until they load." : ""}
                      </p>
                      <button
                        type="button"
                        onClick={() => setChargesReload((n) => n + 1)}
                        style={retryButtonStyle}
                      >
                        Try again
                      </button>
                    </div>
                  )}
                  {chargesStatus === "ready" && availableCharges.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {availableCharges.map((option) => (
                        <div key={option.key} style={chargeOptionRowStyle}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={chargeOptionDescriptionStyle}>
                              {option.description}
                            </div>
                            <div style={chargeOptionAmountStyle}>
                              {formatChargeAmount(option.amount)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => addCharge(option)}
                            disabled={
                              values.lineItems.length >= 20 &&
                              !isBlankOnlyRow(values.lineItems)
                            }
                            style={addChargeButtonStyle}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                      <p style={helperStyle}>
                        Accrued from this client&apos;s revision rounds. Add one
                        and it becomes a line item at the amount the client
                        agreed to; remove the line and it comes back here.
                      </p>
                    </div>
                  )}
                </div>
              )}

            <div>
              <span style={labelStyle}>Line items</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {values.lineItems.map((item, idx) =>
                  item.revisionRoundIds ? (
                    // A charge line: text and amount are the server's, not
                    // editable here. The × returns the charge to the picker.
                    <div key={`li-${idx}`} style={taggedRowStyle}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={taggedDescriptionStyle}>
                          {item.description}
                        </div>
                        <div style={taggedMetaStyle}>
                          Revision charge · the amount the client agreed to
                        </div>
                      </div>
                      <div style={taggedAmountStyle}>
                        {formatChargeAmount(Number(item.amount))}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLineItem(idx)}
                        disabled={isReadOnly}
                        aria-label="Remove revision charge"
                        style={removeButtonStyle(isReadOnly)}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
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
                  )
                )}
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
                disabled={submitting || chargesBlocked}
                style={{ minWidth: 140 }}
              >
                {submitting ? "Saving…" : submitLabel}
              </Button>
            )}
          </div>
        </form>
        )}
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

// --- Revision charges (Phase 8) ---------------------------------------------

// One offerable charge: description over amount, Add at the right. Square,
// bordered, on the raised surface so it reads as a thing to take rather than
// a field to fill.
const chargeOptionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
};

const chargeOptionDescriptionStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-primary)",
  overflowWrap: "anywhere",
};

const chargeOptionAmountStyle: CSSProperties = {
  marginTop: 2,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-body)",
  fontVariantNumeric: "tabular-nums",
};

const addChargeButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 16px",
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
  cursor: "pointer",
};

const retryButtonStyle: CSSProperties = {
  marginTop: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 40,
  padding: "0 14px",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontFamily: "inherit",
  cursor: "pointer",
};

// A charge line among the line items: same row shape as an editable one, but
// text instead of inputs, with a mauve left rule marking it as the client's
// consented amount rather than something typed here.
const taggedRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 48,
  padding: "6px 0 6px 12px",
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  backgroundColor: "var(--surface-raised)",
};

const taggedDescriptionStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-primary)",
  overflowWrap: "anywhere",
};

const taggedMetaStyle: CSSProperties = {
  marginTop: 2,
  fontSize: 11,
  color: "var(--text-muted)",
};

const taggedAmountStyle: CSSProperties = {
  width: 110,
  textAlign: "right",
  paddingRight: 12,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  fontVariantNumeric: "tabular-nums",
};

// The frozen state's message: created, but not fully. Warning-toned left
// rule, the same register the content cycle bar uses for a blocked gate.
const warningStyle: CSSProperties = {
  padding: "12px 14px",
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--status-warning)",
  backgroundColor: "var(--surface-raised)",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--text-primary)",
};
