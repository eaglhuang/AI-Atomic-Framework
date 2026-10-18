import type { PythonEntrypointRecord, PythonImportRecord, PythonSourceFile } from '../index.js';
export declare const PIPELINE_FOLDER_HINTS: string[];
export declare function scanPythonImports(sourceFile: PythonSourceFile): readonly PythonImportRecord[];
export declare function scanPythonEntrypoints(sourceFile: PythonSourceFile): readonly PythonEntrypointRecord[];
