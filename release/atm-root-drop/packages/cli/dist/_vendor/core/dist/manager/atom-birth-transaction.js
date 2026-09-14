import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function snapshotAtomBirth(repositoryRoot, workbenchRelativePath, registryRelativePath, catalogRelativePath) {
    const workbenchPath = path.resolve(repositoryRoot, workbenchRelativePath);
    const registryPath = path.resolve(repositoryRoot, registryRelativePath);
    const catalogPath = path.resolve(repositoryRoot, catalogRelativePath);
    return {
        workbenchPath,
        workbench: snapshotTree(workbenchPath),
        registryPath,
        registry: existsSync(registryPath) ? readFileSync(registryPath) : null,
        catalogPath,
        catalog: existsSync(catalogPath) ? readFileSync(catalogPath) : null
    };
}
export function restoreAtomBirth(transaction) {
    restoreTree(transaction.workbenchPath, transaction.workbench);
    restoreFile(transaction.registryPath, transaction.registry);
    restoreFile(transaction.catalogPath, transaction.catalog);
}
function snapshotTree(root) {
    const files = new Map();
    if (!existsSync(root))
        return { existed: false, files };
    collectTreeFiles(root, root, files);
    return { existed: true, files };
}
function collectTreeFiles(root, current, files) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory())
            collectTreeFiles(root, absolutePath, files);
        else if (entry.isFile())
            files.set(path.relative(root, absolutePath), readFileSync(absolutePath));
    }
}
function restoreTree(root, snapshot) {
    if (existsSync(root))
        rmSync(root, { recursive: true, force: true });
    if (!snapshot.existed)
        return;
    for (const [relativePath, content] of snapshot.files) {
        const absolutePath = path.join(root, relativePath);
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, content);
    }
}
function restoreFile(filePath, content) {
    if (content === null) {
        if (existsSync(filePath))
            rmSync(filePath, { force: true });
        return;
    }
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}
