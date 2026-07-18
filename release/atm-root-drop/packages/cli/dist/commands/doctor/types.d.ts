export interface DoctorOptions {
    cwd: string;
    ciProfile?: string;
    skipChecks?: unknown[];
    [key: string]: unknown;
}
export interface DoctorCheck {
    name: string;
    ok: boolean;
    details: Record<string, unknown> | null;
}
export interface PackageJson {
    name?: string;
    packageManager?: string;
    scripts?: Record<string, string>;
    [key: string]: unknown;
}
