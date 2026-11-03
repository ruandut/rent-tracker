import { Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The add/edit dialog every CRUD screen uses: a form, Save, and (when editing) Delete. */
export function CrudDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  saving,
  error,
  onDelete,
  deleteLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  saving: boolean;
  error?: string | null;
  onDelete?: () => void;
  deleteLabel?: string;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <form id="crud-form" className="grid gap-4" onSubmit={submit}>
            {children}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
          <DialogFooter className="gap-2 sm:justify-between">
            {onDelete ? (
              <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
                <Trash2 /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" form="crud-form" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteLabel ?? "this item"}?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onDelete?.();
                onOpenChange(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Dialog state for a CRUD screen: which record is open (null = new) and its form values.
 * `toForm` turns a record (or nothing) into the editable form shape.
 */
export function useCrudDialog<Row extends { id: number }, Form>(toForm: (row?: Row) => Form) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Form>(() => toForm());
  return {
    open,
    setOpen,
    editing,
    form,
    set: <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value })),
    setForm,
    openNew: (overrides: Partial<Form> = {}) => {
      setEditing(null);
      setForm({ ...toForm(), ...overrides });
      setOpen(true);
    },
    openEdit: (row: Row) => {
      setEditing(row);
      setForm(toForm(row));
      setOpen(true);
    },
  };
}
