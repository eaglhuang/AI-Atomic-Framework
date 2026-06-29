export declare function runHashPlaceholderAudit(options?: {
    root?: string;
}): {
    ok: boolean;
    checked: string[];
    findings: {
        file: string;
        issue: string;
    }[];
};
