import type { AtomicSpecDocument, NormalizedAtomicSpecModel, ParseAtomicSpecFailure, ParseAtomicSpecOptions, ParseAtomicSpecSuccess } from './parse-spec/types.js';
export type { AtomicSpecDocument, AtomicSpecPortRecord, NormalizedAtomicSpecModel, ParseAtomicSpecFailure, ParseAtomicSpecOptions, ParseAtomicSpecSuccess, PromptIssue } from './parse-spec/types.js';
export declare function resolveAtomicSpecSchemaPath(startDirectory?: string): string;
export declare const defaultAtomicSpecSchemaPath: string;
export declare function parseAtomicSpecFile(specOption: string, options?: ParseAtomicSpecOptions): ParseAtomicSpecSuccess | ParseAtomicSpecFailure;
export declare function parseAtomicSpecDocument(specDocument: unknown, options?: ParseAtomicSpecOptions): ParseAtomicSpecSuccess | ParseAtomicSpecFailure;
export declare function normalizeAtomicSpecModel(specDocument: AtomicSpecDocument, options?: ParseAtomicSpecOptions): NormalizedAtomicSpecModel;
