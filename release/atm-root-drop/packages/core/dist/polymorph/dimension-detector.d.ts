export declare function detectPolymorphicDimensions(leftSpec: any, rightSpec: any): {
    explainable: boolean;
    differences: {
        dimension: string;
        left: any;
        right: any;
    }[];
    staticContractStable: boolean;
    matchedDimensions: string[];
};
declare const _default: {
    detectPolymorphicDimensions: typeof detectPolymorphicDimensions;
};
export default _default;
