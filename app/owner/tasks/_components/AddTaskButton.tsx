"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ClientPickerOption } from "../_lib/queries";
import { TaskFormPanel } from "./TaskFormPanel";

interface AddTaskButtonProps {
  clients: ClientPickerOption[];
  label?: string;
}

export function AddTaskButton({ clients, label = "Add Task" }: AddTaskButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <TaskFormPanel
        open={open}
        onClose={() => setOpen(false)}
        mode="add"
        clients={clients}
      />
    </>
  );
}
