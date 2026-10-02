import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

// Hashes are embedded in the launcher, not trusted from the writable cache.
export function renderCacheIntegrityRuntime(payloadFiles: any[]): string {
  const digests = payloadFiles.map(file => ({
    path: file.path,
    sha256: createHash('sha256').update(Buffer.from(file.dataBase64, 'base64')).digest('hex')
  }));
  const encoded = gzipSync(JSON.stringify(digests)).toString('base64');
  return `const fileDigests = JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(encoded)}, 'base64')).toString('utf8'));
function isExtractedRootReady(cacheRoot) {
  try {
    const marker = JSON.parse(readFileSync(path.join(cacheRoot, '.payload-ready.json'), 'utf8'));
    if (marker.payloadSha256 !== payloadSha256) return false;
    return fileDigests.every((file) => {
      const target = resolveFilePath(cacheRoot, file.path);
      const info = lstatSync(target);
      return info.isFile() && !info.isSymbolicLink()
        && createHash('sha256').update(readFileSync(target)).digest('hex') === file.sha256;
    });
  } catch {
    return false;
  }
}`;
}
