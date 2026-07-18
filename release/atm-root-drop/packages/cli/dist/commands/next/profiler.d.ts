export declare function createNextProfiler(header?: string): {
    mark(label: string): void;
    flush(label: string): void;
};
