import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Field, NativeSelect } from "@/components/form";
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
import { Input } from "@/components/ui/input";
import { useRemove, useSave } from "@/lib/api";
import {
  BILL_BUILTINS,
  BILL_CHARGE_TYPES,
  DESTINATIONS,
  FIELD_TYPES,
  LINE_BUILTINS,
  type BillChargeType,
  type BillTemplate,
  type Destination,
  type FieldType,
  type TemplateDefinition,
  type TemplateField,
  type TemplateItem,
  type TemplateSection,
} from "@/lib/types";

let nextId = 1;
const newKey = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${nextId++}`;

const moved = <T,>(list: T[], index: number, by: number) => {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
};
const replaced = <T,>(list: T[], index: number, value: T) =>
  list.map((item, i) => (i === index ? value : item));
const without = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);

const builtinField = (key: string, builtin: (typeof LINE_BUILTINS)[string]): TemplateField => ({
  key,
  label: builtin.label,
  type: builtin.type,
  required: false,
  usage_only: builtin.usage_only ?? false,
});

function MoveButtons({ onMove }: { onMove: (by: number) => void }) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Move up"
        onClick={() => onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Move down"
        onClick={() => onMove(1)}
      >
        <ArrowDown />
      </Button>
    </>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
      <input
        type="checkbox"
        className="size-4 accent-emerald-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** The fields of a bill header or a service. Built-ins can be relabelled, moved or dropped. */
function FieldList({
  fields,
  builtins,
  locked,
  showUsageOnly,
  onChange,
}: {
  fields: TemplateField[];
  builtins: typeof LINE_BUILTINS;
  locked?: string;
  showUsageOnly?: boolean;
  onChange: (fields: TemplateField[]) => void;
}) {
  const absent = Object.entries(builtins).filter(
    ([key]) => !fields.some((field) => field.key === key),
  );
  const add = (choice: string) => {
    if (choice === "custom") {
      const field: TemplateField = {
        key: newKey("custom"),
        label: "New field",
        type: "text",
        required: false,
        usage_only: false,
      };
      onChange([...fields, field]);
    } else if (builtins[choice]) {
      onChange([...fields, builtinField(choice, builtins[choice])]);
    }
  };

  return (
    <div className="grid gap-2">
      {fields.map((field, index) => {
        const builtin = field.key in builtins;
        const isLocked = field.key === locked;
        const change = (update: Partial<TemplateField>) =>
          onChange(replaced(fields, index, { ...field, ...update }));
        return (
          <div key={field.key} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Field label"
              className="min-w-40 flex-1"
              required
              value={field.label}
              onChange={(e) => change({ label: e.target.value })}
            />
            <NativeSelect
              aria-label="Field type"
              className="w-auto"
              disabled={builtin}
              title={builtin ? "Built-in fields keep their type" : undefined}
              value={field.type}
              onChange={(e) => change({ type: e.target.value as FieldType })}
            >
              {Object.entries(FIELD_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <Check
              label="Required"
              checked={field.required}
              disabled={isLocked}
              onChange={(required) => change({ required })}
            />
            {showUsageOnly && (
              <Check
                label="Usage lines only"
                checked={field.usage_only}
                onChange={(usage_only) => change({ usage_only })}
              />
            )}
            <div className="flex">
              <MoveButtons onMove={(by) => onChange(moved(fields, index, by))} />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove field"
                disabled={isLocked}
                title={isLocked ? "Bills are told apart by this field" : undefined}
                onClick={() => onChange(without(fields, index))}
              >
                <X />
              </Button>
            </div>
          </div>
        );
      })}
      <NativeSelect
        aria-label="Add a field"
        className="w-auto justify-self-start"
        value=""
        onChange={(e) => add(e.target.value)}
      >
        <option value="" disabled>
          Add a field…
        </option>
        <option value="custom">Custom field</option>
        {absent.map(([key, builtin]) => (
          <option key={key} value={key}>
            {builtin.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** The one-click items offered when logging a bill in this service. */
function ItemList({
  items,
  onChange,
}: {
  items: TemplateItem[];
  onChange: (items: TemplateItem[]) => void;
}) {
  return (
    <div className="grid gap-2">
      {items.map((item, index) => {
        const change = (update: Partial<TemplateItem>) =>
          onChange(replaced(items, index, { ...item, ...update }));
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Item label"
              className="min-w-40 flex-1"
              required
              value={item.label}
              onChange={(e) => change({ label: e.target.value })}
            />
            <NativeSelect
              aria-label="Item charge type"
              className="w-auto"
              value={item.charge_type}
              onChange={(e) => change({ charge_type: e.target.value as BillChargeType })}
            >
              {Object.entries(BILL_CHARGE_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <div className="flex">
              <MoveButtons onMove={(by) => onChange(moved(items, index, by))} />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove item"
                onClick={() => onChange(without(items, index))}
              >
                <X />
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...items, { label: "New item", charge_type: "basic" }])}
      >
        <Plus /> Add item
      </Button>
    </div>
  );
}

function SectionCard({
  section,
  onChange,
  onMove,
  onRemove,
}: {
  section: TemplateSection;
  onChange: (section: TemplateSection) => void;
  onMove: (by: number) => void;
  onRemove?: () => void;
}) {
  const change = (update: Partial<TemplateSection>) => onChange({ ...section, ...update });
  return (
    <section className="grid gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Service name" className="min-w-48 flex-1">
          <Input
            aria-label="Service name"
            required
            value={section.label}
            onChange={(e) => change({ label: e.target.value })}
          />
        </Field>
        <Field label="Costs go to">
          <NativeSelect
            aria-label="Costs go to"
            value={section.destination}
            onChange={(e) => change({ destination: e.target.value as Destination })}
          >
            {Object.entries(DESTINATIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Usage unit" className="w-24">
          <Input
            aria-label="Usage unit"
            placeholder="kL"
            value={section.usage_unit}
            onChange={(e) => change({ usage_unit: e.target.value })}
          />
        </Field>
        <div className="flex">
          <MoveButtons onMove={onMove} />
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove service"
              onClick={onRemove}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-2">
          <h4 className="text-sm font-medium">Fields on each line</h4>
          <p className="text-xs text-muted-foreground">
            Description, charge type and amount are always there.
          </p>
          <FieldList
            fields={section.fields}
            builtins={LINE_BUILTINS}
            showUsageOnly
            onChange={(fields) => change({ fields })}
          />
        </div>
        <div className="grid content-start gap-2">
          <h4 className="text-sm font-medium">Quick-add items</h4>
          <p className="text-xs text-muted-foreground">
            Buttons for what this service usually bills.
          </p>
          <ItemList items={section.items} onChange={(items) => change({ items })} />
        </div>
      </div>
    </section>
  );
}

type Draft = Pick<BillTemplate, "name" | "is_default" | "definition">;

export function TemplateBuilder({
  template,
  initial,
}: {
  template?: BillTemplate;
  initial: Draft;
}) {
  const [name, setName] = useState(initial.name);
  const [isDefault, setIsDefault] = useState(initial.is_default);
  const [definition, setDefinition] = useState<TemplateDefinition>(initial.definition);
  const [confirming, setConfirming] = useState(false);
  const save = useSave<Record<string, unknown> & { id?: number }>("bill-templates", "Template");
  const remove = useRemove("bill-templates", "Template");
  const navigate = useNavigate();

  const setSections = (sections: TemplateSection[]) => setDefinition({ ...definition, sections });
  const addSection = () =>
    setSections([
      ...definition.sections,
      {
        key: newKey("section"),
        label: "New service",
        destination: "other",
        usage_unit: "",
        fields: [builtinField("vat", LINE_BUILTINS.vat)],
        items: [],
      },
    ]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: template?.id, name, is_default: isDefault, definition },
      { onSuccess: () => void navigate({ to: "/templates" }) },
    );
  };

  return (
    <form onSubmit={submit} className="mx-auto grid w-full max-w-6xl gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/templates">
            <ArrowLeft /> Municipal templates
          </Link>
        </Button>
        {template && (
          <Button type="button" variant="outline" asChild>
            <Link to="/templates/new" search={{ from: template.id }}>
              <Copy /> Copy template
            </Link>
          </Button>
        )}
      </div>

      <section className="flex flex-wrap items-end gap-4 rounded-xl border p-4">
        <Field label="Template name" htmlFor="t-name" className="min-w-56 flex-1">
          <Input
            id="t-name"
            required
            placeholder="The municipality's name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="pb-1.5">
          <Check
            label="Default template"
            checked={isDefault}
            disabled={initial.is_default}
            onChange={setIsDefault}
          />
        </div>
      </section>

      {template && template.bill_count > 0 && (
        <p className="text-sm text-muted-foreground">
          Changes apply to new bills only. The {template.bill_count} logged on this template keep
          the fields they were entered with.
        </p>
      )}

      <section className="grid gap-3 rounded-xl border p-4">
        <div>
          <h3 className="font-medium">Bill details</h3>
          <p className="text-sm text-muted-foreground">
            The fields at the top of the bill. The month is always there.
          </p>
        </div>
        <FieldList
          fields={definition.bill_fields}
          builtins={BILL_BUILTINS}
          locked="account_number"
          onChange={(bill_fields) => setDefinition({ ...definition, bill_fields })}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Services</h3>
        <Button type="button" variant="outline" size="sm" onClick={addSection}>
          <Plus /> Add service
        </Button>
      </div>
      {definition.sections.map((section, index) => (
        <SectionCard
          key={section.key}
          section={section}
          onChange={(next) => setSections(replaced(definition.sections, index, next))}
          onMove={(by) => setSections(moved(definition.sections, index, by))}
          onRemove={
            definition.sections.length > 1
              ? () => setSections(without(definition.sections, index))
              : undefined
          }
        />
      ))}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3 md:-mx-6 md:px-6">
        <p className="text-sm text-destructive">{save.error?.message}</p>
        <div className="flex gap-2">
          {template && !template.is_default && (
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              Bills logged on it stay exactly as they are, but you won't be able to choose it for
              new ones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                template &&
                remove.mutate(template.id, {
                  onSuccess: () => void navigate({ to: "/templates" }),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
