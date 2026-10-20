export declare function detectPolymorphicDimensions(leftSpec: unknown, rightSpec: unknown): {
    explainable: boolean;
    differences: {
        dimension: string;
        left: {} | null;
        right: {} | null;
    }[];
    staticContractStable: boolean;
    matchedDimensions: string[];
};
declare const _default: {
    detectPolymorphicDimensions: typeof detectPolymorphicDimensions;
};
export default _default;
