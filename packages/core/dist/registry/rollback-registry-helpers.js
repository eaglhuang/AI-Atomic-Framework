export function isAtomEntry(entry) {
    return Object.hasOwn(entry, 'atomId');
}
export function isMapEntry(entry) {
    return Object.hasOwn(entry, 'mapId');
}
export function findVersionRecord(entry, version) {
    if (!entry.versions || !Array.isArray(entry.versions)) {
        return null;
    }
    return entry.versions.find((record) => record.version === version) ?? null;
}
export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
export function toPortablePath(value) {
    return value.replace(/\\/g, '/');
}
