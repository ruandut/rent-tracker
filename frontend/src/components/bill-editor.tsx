import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  Download,
  FileUp,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, apiBlob, useAll, useRemove } from "@/lib/api";
import { formatMoney, parseBillAmount, thisMonth } from "@/lib/format";
import {
  BILL_BUILTINS,
  BILL_CHARGE_TYPES,
  LINE_BUILTINS,
  type Bill,
  type BillChargeType,
  type BillLayout,
  type BillLine,
  type RentalUnit,
  type TemplateField,
  type TemplateSection,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Values = Record<string, string>;

type LineForm = {
  key: number;
  section: string;
  charge_type: BillChargeType;
  description: string;
  amount_excl: string;
  /** Everything else on the line, built-in or custom, by field key. */
  values: Values;
};

type UnitForm = { key: number; rental_unit: string; lines: LineForm[] };

export type BillForm = {
  month: string;
  values: Values;
  raw_text: string;
  notes: string;
  units: UnitForm[];
};

const parsed = (value: string) => Number(parseBillAmount(value) || 0);
const cents = (value: number) => Math.round(value * 100);
const shown = (value: unknown, type: TemplateField["type"]) => {
  if (value === null || value === undefined || value === "") return "";
  return type === "money" ? Number(value).toFixed(2) : String(value as string | number);
};

let nextKey = 1;

const blankUnit = (): UnitForm => ({ key: nextKey++, rental_unit: "", lines: [] });

export const blankForm = (): BillForm => ({
  month: thisMonth(),
  values: {},
  raw_text: "",
  notes: "",
  units: [blankUnit()],
});

const fieldValues = (
  fields: TemplateField[],
  builtins: Record<string, unknown>,
  source: Record<string, unknown>,
  extra: Values,
) =>
  Object.fromEntries(
    fields.map((field) => [
      field.key,
      shown(field.key in builtins ? source[field.key] : extra[field.key], field.type),
    ]),
  );

const lineForm = (line: BillLine, layout: BillLayout): LineForm => {
  const section = layout.sections.find((other) => other.key === line.section);
  return {
    key: nextKey++,
    section: line.section,
    charge_type: line.charge_type,
    description: line.description,
    amount_excl: shown(line.amount_excl, "money"),
    values: fieldValues(section?.fields ?? [], LINE_BUILTINS, line, line.extra),
  };
};

export const toForm = (bill: Bill): BillForm => ({
  month: bill.period.slice(0, 7),
  values: fieldValues(bill.layout.bill_fields, BILL_BUILTINS, bill, bill.extra),
  raw_text: bill.raw_text,
  notes: bill.notes,
  units: bill.units.map((share) => ({
    key: nextKey++,
    rental_unit: String(share.rental_unit),
    lines: share.lines.map((line) => lineForm(line, bill.layout)),
  })),
});

/** Next month's form: same units and items, with last month's closing reading as the opening. */
export const carryForward = (previous: Bill, layout: BillLayout): BillForm => {
  const [year, month] = previous.period.split("-").map(Number);
  const next = new Date(year, month, 1);
  const form = toForm(previous);
  const sections = new Map(layout.sections.map((section) => [section.key, section]));
  const keepText = (line: LineForm) =>
    Object.fromEntries(
      (sections.get(line.section)?.fields ?? [])
        .filter((field) => field.type === "text" && !field.usage_only)
        .map((field) => [field.key, line.values[field.key] ?? ""]),
    );
  return {
    ...blankForm(),
    month: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
    values: {
      account_number: previous.account_number,
      opening_balance: shown(previous.amount_due, "money"),
    },
    units: form.units.map((unit) => ({
      ...unit,
      lines: unit.lines
        .filter((line) => sections.has(line.section))
        .map((line) => ({
          ...line,
          amount_excl: "",
          values: {
            ...keepText(line),
            meter_previous: line.values.meter_current ?? "",
            reading_from: line.values.reading_to ?? "",
          },
        })),
    })),
  };
};

const toApi = (value: string, type: TemplateField["type"]) => {
  if (type === "money") return parseBillAmount(value) || null;
  if (type === "text") return value;
  return value === "" ? null : value;
};

/** Built-in fields go to their own columns, custom ones to `extra`. */
const toPayloadFields = (
  fields: TemplateField[],
  builtins: Record<string, unknown>,
  values: Values,
) => {
  const payload: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const field of fields) {
    const value = toApi(values[field.key] ?? "", field.type);
    (field.key in builtins ? payload : extra)[field.key] = value;
  }
  return { ...payload, extra };
};

const toPayload = (form: BillForm, layout: BillLayout, templateId?: number) => ({
  ...(templateId === undefined ? {} : { template: templateId }),
  period: `${form.month}-01`,
  raw_text: form.raw_text,
  notes: form.notes,
  ...toPayloadFields(layout.bill_fields, BILL_BUILTINS, form.values),
  units: form.units.map((unit) => ({
    rental_unit: Number(unit.rental_unit),
    lines: unit.lines.map((line) => {
      const section = layout.sections.find((other) => other.key === line.section);
      const fields = toPayloadFields(section?.fields ?? [], LINE_BUILTINS, line.values);
      return {
        section: line.section,
        charge_type: line.charge_type,
        description: line.description,
        amount_excl: parseBillAmount(line.amount_excl),
        ...fields,
        vat: parseBillAmount(line.values.vat ?? "") || "0",
      };
    }),
  })),
});

const lineCents = (lines: LineForm[]) =>
  lines.reduce(
    (sum, line) => sum + cents(parsed(line.amount_excl)) + cents(parsed(line.values.vat ?? "")),
    0,
  );

const fieldApplies = (field: TemplateField, line: LineForm) =>
  !field.usage_only || line.charge_type === "usage";

/** Takes amounts the way the bill prints them, so they can be pasted straight across. */
function AmountInput({
  value,
  onChange,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
}) {
  return (
    <Input
      {...props}
      inputMode="decimal"
      className="text-right tabular-nums"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onChange(parseBillAmount(value))}
    />
  );
}

/** One template field, as the input its type calls for. */
function FieldInput({
  field,
  label = field.label,
  value,
  onChange,
  onBlur,
  id,
  placeholder,
}: {
  field: TemplateField;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  id?: string;
  placeholder?: string;
}) {
  const common = { id, required: field.required, placeholder, value };
  if (field.type === "money") {
    return <AmountInput {...common} aria-label={label} onChange={onChange} />;
  }
  return (
    <Input
      {...common}
      aria-label={label}
      title={label}
      type={field.type === "date" ? "date" : "text"}
      inputMode={field.type === "number" ? "decimal" : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

export function BillEditor({
  bill,
  layout,
  templateId,
  initial,
}: {
  bill?: Bill;
  layout: BillLayout;
  templateId?: number;
  initial: BillForm;
}) {
  const [form, setForm] = useState(initial);
  const [activeKey, setActiveKey] = useState(initial.units[0].key);
  const [file, setFile] = useState<File | null>(null);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [removingUnit, setRemovingUnit] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const units = useAll<RentalUnit>("units");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useRemove("bills", "Bill");

  const active = form.units.find((unit) => unit.key === activeKey) ?? form.units[0];
  const unitName = (unit: UnitForm) =>
    units.data?.find((other) => String(other.id) === unit.rental_unit)?.name ?? "New unit";
  const free = (units.data ?? []).filter(
    (unit) => unit.is_active && !form.units.some((u) => u.rental_unit === String(unit.id)),
  );
  const canAddUnit = free.length > form.units.filter((unit) => !unit.rental_unit).length;

  const set = <K extends keyof BillForm>(key: K, value: BillForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setValue = (key: string, value: string) =>
    setForm((f) => ({ ...f, values: { ...f.values, [key]: value } }));
  const changeActive = (change: (unit: UnitForm) => UnitForm) =>
    setForm((f) => ({
      ...f,
      units: f.units.map((unit) => (unit.key === active.key ? change(unit) : unit)),
    }));
  const setLine = (key: number, change: Partial<LineForm>) =>
    changeActive((unit) => ({
      ...unit,
      lines: unit.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    }));
  const addLine = (section: string, label: string, charge_type: BillChargeType) =>
    changeActive((unit) => {
      const sibling = unit.lines.findLast((line) => line.section === section);
      const line: LineForm = {
        key: nextKey++,
        section,
        charge_type,
        description: label,
        amount_excl: "",
        values: sibling?.values.meter_number ? { meter_number: sibling.values.meter_number } : {},
      };
      // Lines stay in section order, so a new one lands at the end of its own section.
      const order = layout.sections.map((other) => other.key);
      const at = unit.lines.findIndex(
        (other) => order.indexOf(other.section) > order.indexOf(section),
      );
      const lines = [...unit.lines];
      lines.splice(at === -1 ? lines.length : at, 0, line);
      return { ...unit, lines };
    });

  /** Adds a unit, or a copy of this one to adjust. With one unit left, that's the one it is. */
  const addUnit = (copyLines: boolean) => {
    const unit: UnitForm = {
      key: nextKey++,
      rental_unit: free.length === 1 ? String(free[0].id) : "",
      lines: copyLines ? active.lines.map((line) => ({ ...line, key: nextKey++ })) : [],
    };
    set("units", [...form.units, unit]);
    setActiveKey(unit.key);
  };
  const removeUnit = () => {
    const rest = form.units.filter((unit) => unit.key !== active.key);
    set("units", rest);
    setActiveKey(rest[0].key);
  };

  const save = useMutation({
    mutationFn: async () => {
      const saved = await api<Bill>(bill ? `/api/bills/${bill.id}/` : "/api/bills/", {
        method: bill ? "PATCH" : "POST",
        body: JSON.stringify(toPayload(form, layout, bill ? undefined : templateId)),
      });
      if (file) {
        const body = new FormData();
        body.append("file", file);
        await api(`/api/bills/${saved.id}/attachment/`, { method: "POST", body });
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(bill ? "Bill updated" : "Bill logged");
      setFile(null);
      void queryClient.invalidateQueries();
      if (!bill)
        void navigate({
          to: "/bills/$billId",
          params: { billId: String(saved.id) },
          replace: true,
        });
    },
  });

  /** Only one unit is on screen, so the browser can't flag a gap in the others. */
  const findGap = (): { unit: UnitForm; message: string } | null => {
    for (const unit of form.units) {
      if (!unit.rental_unit) return { unit, message: "Choose a rental unit for each tab." };
      for (const line of unit.lines) {
        const section = layout.sections.find((other) => other.key === line.section);
        if (parseBillAmount(line.amount_excl) === "") {
          return { unit, message: `${unitName(unit)} has a line with no amount.` };
        }
        const missing = section?.fields.find(
          (field) => field.required && fieldApplies(field, line) && !line.values[field.key],
        );
        if (missing) {
          return { unit, message: `${unitName(unit)} needs ${missing.label} on every line.` };
        }
      }
    }
    return null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const gap = findGap();
    if (gap) {
      setActiveKey(gap.unit.key);
      setProblem(gap.message);
      return;
    }
    setProblem(null);
    save.mutate();
  };

  const totalCents = form.units.reduce((sum, unit) => sum + lineCents(unit.lines), 0);
  const lineCount = form.units.reduce((sum, unit) => sum + unit.lines.length, 0);
  const stated = parseBillAmount(form.values.stated_total ?? "");
  const difference = stated === "" ? null : totalCents - cents(Number(stated));

  return (
    <form onSubmit={submit} className="mx-auto grid w-full max-w-[110rem] gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/bills">
              <ArrowLeft /> Municipal bills
            </Link>
          </Button>
          <span className="truncate text-sm text-muted-foreground">{layout.name}</span>
        </div>
        <Button type="button" variant="outline" onClick={() => setSourceOpen((open) => !open)}>
          {sourceOpen ? <PanelRightClose /> : <PanelRightOpen />}
          {sourceOpen ? "Hide bill" : "Show bill"}
        </Button>
      </div>

      <div
        className={cn(
          "grid items-start gap-4",
          sourceOpen && "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
        )}
      >
        <div className="order-2 grid min-w-0 gap-4 xl:order-1">
          <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Bill month" htmlFor="b-month">
              <Input
                id="b-month"
                type="month"
                required
                value={form.month}
                onChange={(e) => set("month", e.target.value)}
              />
            </Field>
            {layout.bill_fields.map((field) => (
              <Field key={field.key} label={field.label} htmlFor={`b-${field.key}`}>
                <FieldInput
                  id={`b-${field.key}`}
                  field={field}
                  value={form.values[field.key] ?? ""}
                  onChange={(value) => setValue(field.key, value)}
                />
              </Field>
            ))}
          </section>

          <p className="text-sm text-muted-foreground">
            Paste amounts as the bill prints them. Brackets, such as (R 144.33), mean a credit.
          </p>

          <section className="grid gap-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs
                value={String(active.key)}
                onValueChange={(value) => setActiveKey(Number(value))}
                className="min-w-0"
              >
                <TabsList className="h-auto flex-wrap justify-start">
                  {form.units.map((unit) => (
                    <TabsTrigger key={unit.key} value={String(unit.key)}>
                      {unitName(unit)}
                      <span className="text-muted-foreground tabular-nums">
                        {formatMoney(lineCents(unit.lines) / 100)}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canAddUnit}
                  title={canAddUnit ? undefined : "Every rental unit is already on this bill"}
                  onClick={() => addUnit(false)}
                >
                  <Plus /> Add unit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canAddUnit}
                  title={
                    canAddUnit
                      ? "Start another unit from a copy of this one"
                      : "Every rental unit is already on this bill"
                  }
                  onClick={() => addUnit(true)}
                >
                  <Copy /> Copy to another unit
                </Button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Field label="Rental unit" htmlFor="b-unit" className="max-w-xs flex-1">
                <NativeSelect
                  id="b-unit"
                  required
                  value={active.rental_unit}
                  onChange={(e) =>
                    changeActive((unit) => ({ ...unit, rental_unit: e.target.value }))
                  }
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {units.data
                    ?.filter((unit) => unit.is_active || String(unit.id) === active.rental_unit)
                    .map((unit) => (
                      <option
                        key={unit.id}
                        value={unit.id}
                        disabled={form.units.some(
                          (other) =>
                            other.key !== active.key && other.rental_unit === String(unit.id),
                        )}
                      >
                        {unit.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              {form.units.length > 1 && (
                <Button type="button" variant="ghost" onClick={() => setRemovingUnit(true)}>
                  Remove from bill
                </Button>
              )}
            </div>
          </section>

          {layout.sections.map((section) => (
            <Section
              key={section.key}
              section={section}
              lines={active.lines.filter((line) => line.section === section.key)}
              onAdd={(label, type) => addLine(section.key, label, type)}
              onChange={setLine}
              onRemove={(key) =>
                changeActive((unit) => ({
                  ...unit,
                  lines: unit.lines.filter((line) => line.key !== key),
                }))
              }
            />
          ))}

          <Field label="Notes" htmlFor="b-notes">
            <Textarea
              id="b-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        {sourceOpen && (
          <div className="order-1 min-w-0 xl:sticky xl:top-16 xl:order-2">
            <Source
              bill={bill}
              rawText={form.raw_text}
              onRawText={(value) => set("raw_text", value)}
              file={file}
              onFile={setFile}
            />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3 md:-mx-6 md:px-6">
        <div className="text-sm">
          <span className="font-medium tabular-nums">{formatMoney(totalCents / 100)}</span>{" "}
          <span className="text-muted-foreground">
            from {lineCount} lines across {form.units.length}{" "}
            {form.units.length === 1 ? "unit" : "units"}
          </span>
          {difference !== null && (
            <span
              className={cn(
                "ml-2 font-medium",
                difference === 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {difference === 0
                ? "Matches the bill"
                : `${formatMoney(Math.abs(difference) / 100)} ${difference > 0 ? "over" : "short of"} the bill`}
            </span>
          )}
          {(problem ?? save.error) && (
            <p className="text-destructive">{problem ?? save.error?.message}</p>
          )}
        </div>
        <div className="flex gap-2">
          {bill && (
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save bill"}
          </Button>
        </div>
      </div>

      <AlertDialog open={removingUnit} onOpenChange={setRemovingUnit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {unitName(active)} from this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {active.lines.length} lines go too. Nothing changes until you save the bill.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removeUnit}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              Every unit's lines, the file, and the rows it created under Water & electricity and
              Rates & taxes all go too. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                bill && remove.mutate(bill.id, { onSuccess: () => void navigate({ to: "/bills" }) })
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

function Section({
  section,
  lines,
  onAdd,
  onChange,
  onRemove,
}: {
  section: TemplateSection;
  lines: LineForm[];
  onAdd: (label: string, type: BillChargeType) => void;
  onChange: (key: number, change: Partial<LineForm>) => void;
  onRemove: (key: number) => void;
}) {
  return (
    <section className="grid gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {section.label}{" "}
          {lines.length > 0 && (
            <span className="ml-1 font-normal text-muted-foreground tabular-nums">
              {formatMoney(lineCents(lines) / 100)}
            </span>
          )}
        </h3>
        <div className="flex flex-wrap gap-1">
          {(section.items.length ? section.items : [DEFAULT_ITEM]).map((item) => (
            <Button
              key={item.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onAdd(item.label === DEFAULT_ITEM.label ? "" : item.label, item.charge_type)
              }
            >
              <Plus /> {item.label}
            </Button>
          ))}
        </div>
      </div>
      {lines.map((line) => (
        <LineRow
          key={line.key}
          section={section}
          line={line}
          onChange={(change) => onChange(line.key, change)}
          onRemove={() => onRemove(line.key)}
        />
      ))}
    </section>
  );
}

const DEFAULT_ITEM = { label: "Add line", charge_type: "other" as BillChargeType };

function LineRow({
  section,
  line,
  onChange,
  onRemove,
}: {
  section: TemplateSection;
  line: LineForm;
  onChange: (change: Partial<LineForm>) => void;
  onRemove: () => void;
}) {
  const vat = section.fields.find((field) => field.key === "vat");
  const others = section.fields.filter((field) => field.key !== "vat" && fieldApplies(field, line));
  const setValue = (key: string, value: string) =>
    onChange({ values: { ...line.values, [key]: value } });

  /** Bills print consumption, but it's always closing minus opening, so offer that. */
  const fillUsage = () => {
    const { usage, meter_current: current, meter_previous: previous } = line.values;
    if (usage || !current || !previous || !others.some((field) => field.key === "usage")) return;
    const used = Number(current) - Number(previous);
    if (used >= 0) setValue("usage", String(Number(used.toFixed(3))));
  };

  return (
    <div className="grid gap-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Input
          aria-label="Description"
          placeholder="As printed on the bill"
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <NativeSelect
          aria-label="Type of charge"
          value={line.charge_type}
          onChange={(e) => onChange({ charge_type: e.target.value as BillChargeType })}
        >
          {Object.entries(BILL_CHARGE_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <AmountInput
          aria-label="Charge excluding VAT"
          placeholder={vat ? "Excl. VAT" : "Amount"}
          required
          value={line.amount_excl}
          onChange={(amount_excl) => onChange({ amount_excl })}
        />
        {vat ? (
          <FieldInput
            field={vat}
            placeholder={vat.label}
            value={line.values.vat ?? ""}
            onChange={(value) => setValue("vat", value)}
          />
        ) : (
          <span />
        )}
        <span
          className="col-start-1 row-start-2 text-sm text-muted-foreground tabular-nums sm:col-start-auto sm:row-start-auto sm:text-right"
          title="Line total"
        >
          {formatMoney(lineCents([line]) / 100)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove line"
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {others.map((field) => {
            const label =
              field.key === "usage" && section.usage_unit
                ? `${field.label} (${section.usage_unit})`
                : field.label;
            return (
              <FieldInput
                key={field.key}
                field={field}
                label={label}
                placeholder={label}
                value={line.values[field.key] ?? ""}
                onChange={(value) => setValue(field.key, value)}
                onBlur={fillUsage}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

const PREVIEWABLE = /^(application\/pdf|image\/)/;

/** The bill itself: its pasted content and the original file, kept in view while typing. */
function Source({
  bill,
  rawText,
  onRawText,
  file,
  onFile,
}: {
  bill?: Bill;
  rawText: string;
  onRawText: (value: string) => void;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const saved = bill?.attachment ?? null;
  const stored = useQuery({
    queryKey: ["bills", "attachment", bill?.id, saved?.filename, saved?.size],
    queryFn: () => apiBlob(`/api/bills/${bill!.id}/attachment/`),
    enabled: !!saved && !file,
  });
  const blob = file ?? (saved ? stored.data : undefined);
  const name = file?.name ?? saved?.filename;
  const type = file?.type ?? saved?.content_type ?? "";

  // Not revoked: it's at most one small file per change, released when the page closes.
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  const removeStored = useMutation({
    mutationFn: () => api(`/api/bills/${bill!.id}/attachment/`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (error) => toast.error(error.message),
  });

  return (
    <section className="grid gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">The bill</h3>
        <div className="flex flex-wrap items-center gap-1">
          {name && url && (
            <Button type="button" variant="ghost" size="sm" asChild>
              <a href={url} download={name}>
                <Download /> <span className="max-w-40 truncate">{name}</span>
              </a>
            </Button>
          )}
          {name && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove file"
              onClick={() => (file ? onFile(null) : removeStored.mutate())}
            >
              <X />
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <FileUp /> {name ? "Replace file" : "Add file"}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            aria-label="Bill file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.eml,.html"
            onChange={(e) => {
              onFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {url &&
        PREVIEWABLE.test(type) &&
        (type.startsWith("image/") ? (
          <img src={url} alt={name} className="max-h-[50svh] w-full rounded-md object-contain" />
        ) : (
          <iframe src={url} title={name} className="h-[50svh] w-full rounded-md border" />
        ))}
      <Textarea
        aria-label="Raw bill content"
        placeholder="Paste the bill's email here to keep it with this entry."
        className="h-[30svh] resize-y font-mono text-xs whitespace-pre"
        wrap="off"
        value={rawText}
        onChange={(e) => onRawText(e.target.value)}
      />
    </section>
  );
}
