export declare function normalizeAtomId(value: any, fieldName: any): string;
export declare function normalizeMapId(value: any): string;
export declare function normalizeSemver(value: any, fieldName: any): string;
export declare function normalizeRequiredText(value: any, fieldName: any): string;
export declare function normalizeSpecVersion(value: any): string;
export declare function inferSpecVersion(input: any): "0.1.0" | "0.2.0";
export declare function assertSpecVersionSupportsMapSurface(specVersion: any, input: any): void;
