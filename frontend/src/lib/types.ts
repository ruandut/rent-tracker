// Shapes returned by the Django API. Money comes back as numbers (COERCE_DECIMAL_TO_STRING off).

export type Id = number;

export type RentalUnit = {
  id: Id;
  name: string;
  address: string;
  notes: string;
  is_active: boolean;
  income: number;
  expense: number;
};

export type PaymentMethodKind =
  | "bank_account"
  | "savings_account"
  | "credit_card"
  | "debit_card"
  | "cash"
  | "other";

export type PaymentMethod = {
  id: Id;
  name: string;
  kind: PaymentMethodKind;
  institution: string;
  last4: string;
  opening_balance: number;
  is_active: boolean;
  notes: string;
  balance: number;
  income: number;
  expense: number;
  moved_in: number;
  moved_out: number;
};

export type Beneficiary = {
  id: Id;
  name: string;
  relationship: string;
  notes: string;
  paid: number;
  received: number;
  count: number;
};

export type Tag = {
  id: Id;
  name: string;
  color: string;
  is_system: boolean;
  total: number;
  count: number;
};

export type TransactionKind = "income" | "expense" | "transfer";

export type Transaction = {
  id: Id;
  kind: TransactionKind;
  amount: number;
  date: string;
  description: string;
  payment_method: Id;
  payment_method_name: string;
  transfer_to: Id | null;
  transfer_to_name: string | null;
  rental_unit: Id | null;
  rental_unit_name: string | null;
  beneficiary: Id | null;
  beneficiary_name: string | null;
  tags: Id[];
  reference: string;
  notes: string;
  source: "manual" | "email";
};

export type UtilityKind = "water" | "electricity";

export type UtilityReading = {
  id: Id;
  rental_unit: Id;
  rental_unit_name: string;
  kind: UtilityKind;
  period: string;
  meter_reading: number | null;
  usage: number | null;
  cost: number | null;
  notes: string;
  bill: Id | null;
};

export type ChargeCategory = "rates_taxes" | "refuse" | "sewerage" | "levy" | "insurance" | "other";

export type MunicipalCharge = {
  id: Id;
  rental_unit: Id;
  rental_unit_name: string;
  category: ChargeCategory;
  period: string;
  amount: number;
  description: string;
  transaction: Id | null;
  notes: string;
  bill: Id | null;
};

export type BillChargeType = "basic" | "capacity" | "usage" | "rebate" | "other";

export type FieldType = "text" | "number" | "money" | "date";
export type Destination =
  | "water"
  | "electricity"
  | "rates_taxes"
  | "refuse"
  | "sewerage"
  | "levy"
  | "insurance"
  | "other"
  | "none";

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  usage_only: boolean;
};

export type TemplateItem = { label: string; charge_type: BillChargeType };

export type TemplateSection = {
  key: string;
  label: string;
  destination: Destination;
  usage_unit: string;
  fields: TemplateField[];
  items: TemplateItem[];
};

export type TemplateDefinition = { bill_fields: TemplateField[]; sections: TemplateSection[] };

/** A bill's own copy of the template it was logged on. */
export type BillLayout = TemplateDefinition & { name: string };

export type BillTemplate = {
  id: Id;
  name: string;
  is_default: boolean;
  definition: TemplateDefinition;
  bill_count: number;
};

export type BillLine = {
  id: Id;
  section: string;
  charge_type: BillChargeType;
  description: string;
  meter_number: string;
  meter_previous: number | null;
  meter_current: number | null;
  reading_from: string | null;
  reading_to: string | null;
  usage: number | null;
  amount_excl: number;
  vat: number;
  extra: Record<string, string>;
  total: number;
};

/** One rental unit's share of a printed bill. */
export type BillShare = {
  id: Id;
  rental_unit: Id;
  rental_unit_name: string;
  total: number;
  lines: BillLine[];
};

export type BillService = {
  total: number;
  usage: number | null;
  usage_unit: string;
  destination: Destination;
};

export type BillSummary = {
  id: Id;
  template: Id | null;
  template_name: string;
  period: string;
  account_number: string;
  invoice_number: string;
  statement_date: string | null;
  due_date: string | null;
  opening_balance: number | null;
  stated_total: number | null;
  amount_due: number | null;
  total_excl: number;
  total_vat: number;
  total: number;
  services: Record<string, BillService>;
  units: Pick<BillShare, "rental_unit" | "rental_unit_name" | "total">[];
};

export type Bill = Omit<BillSummary, "units"> & {
  layout: BillLayout;
  extra: Record<string, string>;
  raw_text: string;
  notes: string;
  units: BillShare[];
  attachment: { filename: string; content_type: string; size: number } | null;
};

export type SummaryChannel = "email" | "telegram";
export type SummaryFrequency = "once" | "daily" | "weekly" | "monthly";

export type SummarySchedule = {
  id: Id;
  name: string;
  channel: SummaryChannel;
  recipient: string;
  frequency: SummaryFrequency;
  start_at: string;
  is_enabled: boolean;
  next_run_at: string | null;
  last_sent_at: string | null;
  last_error: string;
};

export type DeliverySettings = {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_use_tls: boolean;
  from_email: string;
  has_smtp_password: boolean;
  has_telegram_bot_token: boolean;
};

export const SUMMARY_FREQUENCIES: Record<SummaryFrequency, string> = {
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export type Totals = { income: number; expense: number; net: number };

export type Dashboard = {
  balance: number;
  available: number;
  savings: number;
  accounts: { id: Id; name: string; kind: PaymentMethodKind; balance: number }[];
  month: Totals & { start: string };
  range: Totals;
  monthly: { month: string; income: number; expense: number }[];
  by_tag: { id: Id; name: string; color: string; total: number }[];
  recent: Transaction[];
};

export const PAYMENT_METHOD_KINDS: Record<PaymentMethodKind, string> = {
  bank_account: "Bank account",
  savings_account: "Savings account",
  credit_card: "Credit card",
  debit_card: "Debit card",
  cash: "Cash",
  other: "Other",
};

export const CHARGE_CATEGORIES: Record<ChargeCategory, string> = {
  rates_taxes: "Rates & taxes",
  refuse: "Refuse",
  sewerage: "Sewerage",
  levy: "Levy",
  insurance: "Insurance",
  other: "Other",
};

type Builtin = Pick<TemplateField, "label" | "type"> & { usage_only?: boolean };

/** Fields with a column and a meaning of their own. Everything else is custom. */
export const BILL_BUILTINS: Record<string, Builtin> = {
  account_number: { label: "Account number", type: "text" },
  invoice_number: { label: "Invoice number", type: "text" },
  statement_date: { label: "Statement date", type: "date" },
  due_date: { label: "Due date", type: "date" },
  opening_balance: { label: "Opening balance", type: "money" },
  stated_total: { label: "Total for the month", type: "money" },
  amount_due: { label: "Amount due", type: "money" },
};

export const LINE_BUILTINS: Record<string, Builtin> = {
  vat: { label: "VAT", type: "money" },
  meter_number: { label: "Meter number", type: "text" },
  meter_previous: { label: "Previous reading", type: "number", usage_only: true },
  meter_current: { label: "Current reading", type: "number", usage_only: true },
  usage: { label: "Usage", type: "number", usage_only: true },
  reading_from: { label: "Previous reading date", type: "date", usage_only: true },
  reading_to: { label: "Current reading date", type: "date", usage_only: true },
};

export const FIELD_TYPES: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  date: "Date",
};

export const DESTINATIONS: Record<Destination, string> = {
  water: "Water readings",
  electricity: "Electricity readings",
  rates_taxes: "Rates & taxes",
  refuse: "Refuse",
  sewerage: "Sewerage",
  levy: "Levy",
  insurance: "Insurance",
  other: "Other charges",
  none: "Nowhere, bill only",
};

export const BILL_CHARGE_TYPES: Record<BillChargeType, string> = {
  basic: "Basic / fixed",
  capacity: "Amperage",
  usage: "Usage",
  rebate: "Rebate / free",
  other: "Other",
};

export const UTILITY_KINDS: Record<UtilityKind, { label: string; unit: string }> = {
  water: { label: "Water", unit: "kL" },
  electricity: { label: "Electricity", unit: "kWh" },
};
