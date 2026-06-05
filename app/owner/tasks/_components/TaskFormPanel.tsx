"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { ClientPickerOption, TaskCategory } from "../_lib/queries";
import { TASK_CATEGORIES, categoryLabel } from "../_lib/format";
import { createTask, updateTask } from "../_actions";

export interface TaskFormInitialValues {
  id?: string;
  title: string;
  client_id: string | null;
  category: TaskCategory | null;
  due_date: string | null;
}

interface TaskFormPanelProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  clients: ClientPickerOption[];
  initialValues?: TaskFormInitialValues;
}

const emptyValues: TaskFormInitialValues = {
  title: "",
  client_id: null,
  category: null,
  due_date: null,
};

export function TaskFormPanel({
  open,
  onClose,
  mode,
  clients,
  initialValues,
}: TaskFormPanelProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [clientId, setClientId] = useState(initialValues?.client_id ?? "");
  const [category, setCategory] = useState<string>(initialValues?.category ?? "");
  const [dueDate, setDueDate] = useState(initialValues?.due_date ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form each time it opens (and when editing a different task), so
  // a reused panel never shows the previous task's values.
  useEffect(() => {
    if (open) {
      const v = initialValues ?? emptyValues;
      setTitle(v.title);
      setClientId(v.client_id ?? "");
      setCategory(v.category ?? "");
      setDueDate(v.due_date ?? "");
      setError(null);
      setLoading(false);
    }
  }, [open, initialValues]);

  const trimmedTitle = title.trim();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        title: trimmedTitle,
        client_id: clientId || null,
        category: (category || null) as TaskCategory | null,
        due_date: dueDate || null,
      };
      const result =
        mode === "add"
          ? await createTask(payload)
          : initialValues?.id
            ? await updateTask(initialValues.id, payload)
            : { ok: false as const, error: "Missing task id" };
      if (!result.ok) {
        setError(result.error ?? "Failed to save task.");
        return;
      }
      // Match the existing XFormPanel pattern: the action already called
      // revalidatePath('/owner/tasks'); the panel closes and refreshes.
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  const panelTitle = mode === "add" ? "Add Task" : "Edit Task";

  return (
    <SlidePanel open={open} onClose={onClose} title={panelTitle}>
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <div>
            <label htmlFor="task-title" style={labelStyle}>
              Title
            </label>
            <input
              id="task-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="task-client" style={labelStyle}>
              Client (optional)
            </label>
            <select
              id="task-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p style={helperStyle}>
              A client is required to start a timer on this task (coming soon).
            </p>
          </div>

          <div>
            <label htmlFor="task-category" style={labelStyle}>
              Category (optional)
            </label>
            <select
              id="task-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              <option value="">No category</option>
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="task-due" style={labelStyle}>
              Due date (optional)
            </label>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div className="pt-6 flex flex-col gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={loading || !trimmedTitle}
            className="w-full"
            style={{ width: "100%" }}
          >
            {loading
              ? "Working…"
              : mode === "add"
                ? "Save task"
                : "Save changes"}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}
