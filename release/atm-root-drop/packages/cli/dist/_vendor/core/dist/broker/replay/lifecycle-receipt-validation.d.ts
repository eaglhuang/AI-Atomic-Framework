import type { LifecycleReceiptValidation, LifecycleReceiptVerdict } from './lifecycle-receipt-types.js';
export declare function finishValidation(verdict: LifecycleReceiptVerdict, reasons: readonly string[], invariantCodes: readonly ('INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010')[]): LifecycleReceiptValidation;
