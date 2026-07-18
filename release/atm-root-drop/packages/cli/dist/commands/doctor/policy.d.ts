import type { DoctorCheck, DoctorOptions } from './types.ts';
export declare function resolveDoctorPolicy(options: DoctorOptions): {
    ciProfile: string | null;
    skipChecks: string[];
    skipReason: string | null;
};
export declare function applyDoctorPolicyToCheck(check: DoctorCheck, policy: ReturnType<typeof resolveDoctorPolicy>): DoctorCheck;
export declare function downgradeAdopterGitHeadEvidenceCheck(check: DoctorCheck, repoIdentity: {
    isFrameworkRepo: boolean;
}): DoctorCheck;
