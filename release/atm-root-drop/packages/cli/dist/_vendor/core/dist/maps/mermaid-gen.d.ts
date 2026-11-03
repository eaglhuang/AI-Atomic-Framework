export interface MermaidGenResult {
    mapId: string;
    mermaidSource: string;
    nodeCount: number;
    edgeCount: number;
    generatedAt: string;
}
export declare function generateMermaidFromMapSpec(repositoryRoot: string, mapId: string): MermaidGenResult;
