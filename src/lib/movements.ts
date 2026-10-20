import type { ledgerKinds } from "@/db/schema";

type LedgerKind = (typeof ledgerKinds.enumValues)[number];

/**
 * Manual movements of the shop account. The amount is always entered as a positive number;
 * the type decides whether it adds to (+1) or takes from (-1) the account. "Other" always
 * needs a description so the ledger stays readable.
 */
export const MOVEMENT_TYPES: readonly {
  value: string;
  kind: LedgerKind;
  sign: 1 | -1;
  needsNote: boolean;
}[] = [
  { value: "deposit", kind: "deposit", sign: 1, needsNote: false },
  { value: "withdrawal", kind: "withdrawal", sign: -1, needsNote: false },
  { value: "expense", kind: "expense", sign: -1, needsNote: false },
  { value: "vat_payment", kind: "vat_payment", sign: -1, needsNote: false },
  { value: "tax_payment", kind: "tax_payment", sign: -1, needsNote: false },
  { value: "prior_payment", kind: "prior_payment", sign: -1, needsNote: false },
  { value: "adjustment_in", kind: "adjustment", sign: 1, needsNote: false },
  { value: "adjustment_out", kind: "adjustment", sign: -1, needsNote: false },
  { value: "other_in", kind: "other", sign: 1, needsNote: true },
  { value: "other_out", kind: "other", sign: -1, needsNote: true },
];

export type MovementState = { status: "idle" | "ok" | "invalid" | "note" };
