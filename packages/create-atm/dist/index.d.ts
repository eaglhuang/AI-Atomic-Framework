#!/usr/bin/env node
export declare const createAtmPackage: {
    readonly packageName: "create-atm";
    readonly packageRole: "npm-create-governance-onboarding";
    readonly packageVersion: "0.0.0";
};
type CreateAtmDistTag = 'latest' | 'next' | 'beta' | 'lts';
export declare function runCreateAtm(argv?: string[]): number;
export declare function parseExactCliVersion(value: string, tag: CreateAtmDistTag): string;
export {};
