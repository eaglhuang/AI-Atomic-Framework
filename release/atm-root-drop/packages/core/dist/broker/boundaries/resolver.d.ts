import { type ContentAnchor, type ContentAnchorLocation, type ContentAnchorResolution } from './content-anchor.js';
export declare const CONTENT_ANCHOR_RESOLVER_VERSION = "content-anchor-resolver@0.1.0";
export interface ContentAnchorResolverAdapter {
    readonly adapterId: string;
    readonly adapterVersion: string;
    supports(filePath: string, sourceText: string): boolean;
    findSymbol?(sourceText: string, symbolName: string): readonly ContentAnchorLocation[];
}
export declare function resolveContentAnchor(input: {
    readonly anchor: ContentAnchor;
    readonly currentFilePath: string;
    readonly currentSourceText: string;
    readonly adapter?: ContentAnchorResolverAdapter;
}): ContentAnchorResolution;
