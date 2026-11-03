/**
 * O_APPEND records are newline terminated. Ignore an incomplete final record;
 * corruption before the last nonblank line requires explicit recovery.
 * Kept dependency free so the prereg kit can use a type-stripped copy.
 */
export declare function parseLiveWriteJournal(text: string): unknown[];
