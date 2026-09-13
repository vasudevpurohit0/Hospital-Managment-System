/**
 * Central registry of every human-readable document number the hospital issues.
 *
 * Keeping the definitions in one place means the format of an OPD number or a
 * receipt number is stated once, and every module that needs one asks for it by
 * key rather than assembling a string of its own.
 */

/** When the counter restarts from 1. */
export type SequenceReset = 'YEARLY' | 'DAILY' | 'NEVER';

export interface SequenceDefinition {
  /** Logical counter name. Combined with the period key it is unique. */
  readonly name: string;
  /** How often the counter resets. */
  readonly reset: SequenceReset;
  /** Zero-padding width applied to the numeric part. */
  readonly padding: number;
  /** Assembles the final code from the resolved period and padded sequence. */
  readonly format: (periodKey: string, sequence: string) => string;
}

/** Two-digit year, e.g. "26" for 2026. */
const shortYear = (periodKey: string): string => periodKey.slice(2, 4);

export const SEQUENCES = {
  /** OPD/2026/000123 — one per OPD visit. */
  OPD_NUMBER: {
    name: 'OPD',
    reset: 'YEARLY',
    padding: 6,
    format: (period, seq) => `OPD/${period}/${seq}`,
  },

  /** IPD/2026/000045 — one per admission. */
  IPD_NUMBER: {
    name: 'IPD',
    reset: 'YEARLY',
    padding: 6,
    format: (period, seq) => `IPD/${period}/${seq}`,
  },

  /** LAB/2026/00087 — one per lab order. */
  LAB_NUMBER: {
    name: 'LAB',
    reset: 'YEARLY',
    padding: 5,
    format: (period, seq) => `LAB/${period}/${seq}`,
  },

  /** RCPT/2026/004512 — one per issued receipt. */
  RECEIPT_NUMBER: {
    name: 'RECEIPT',
    reset: 'YEARLY',
    padding: 6,
    format: (period, seq) => `RCPT/${period}/${seq}`,
  },

  /** S26-0000731 — barcoded specimen identifier. */
  SAMPLE_CODE: {
    name: 'SAMPLE',
    reset: 'YEARLY',
    padding: 7,
    format: (period, seq) => `S${shortYear(period)}-${seq}`,
  },
} as const satisfies Record<string, SequenceDefinition>;

export type SequenceKey = keyof typeof SEQUENCES;

/**
 * Daily OPD queue token, scoped per department: CARDIO-001.
 *
 * Departments are data rather than code, so this counter is built on demand
 * instead of being listed in SEQUENCES.
 */
export function queueTokenSequence(departmentCode: string): SequenceDefinition {
  const code = departmentCode.trim().toUpperCase();
  return {
    name: `TOKEN:${code}`,
    reset: 'DAILY',
    padding: 3,
    format: (_period, seq) => `${code}-${seq}`,
  };
}
