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

export type PaymentMethodKind = "bank_account" | "credit_card" | "debit_card" | "cash" | "other";

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

export type TransactionKind = "income" | "expense";

export type Transaction = {
  id: Id;
  kind: TransactionKind;
  amount: number;
  date: string;
  description: string;
  payment_method: Id;
  payment_method_name: string;
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
  usage: number;
  cost: number | null;
  notes: string;
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
  accounts: { id: Id; name: string; kind: PaymentMethodKind; balance: number }[];
  month: Totals & { start: string };
  range: Totals;
  monthly: { month: string; income: number; expense: number }[];
  by_tag: { id: Id; name: string; color: string; total: number }[];
  recent: Transaction[];
};

export const PAYMENT_METHOD_KINDS: Record<PaymentMethodKind, string> = {
  bank_account: "Bank account",
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

export const UTILITY_KINDS: Record<UtilityKind, { label: string; unit: string }> = {
  water: { label: "Water", unit: "kL" },
  electricity: { label: "Electricity", unit: "kWh" },
};
