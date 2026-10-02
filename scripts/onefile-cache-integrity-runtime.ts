import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

// Hashes are embedded in the launcher, not trusted from the writable cache.
export function renderCacheIntegrityRuntime(payloadFiles: any[]): string {
  const digest = createHash('sha256');
  for (const file of payloadFiles) {
    const data = Buffer.from(file.dataBase64, 'base64');
    digest.update(JSON.stringify([file.path, data.length])).update(data);
  }
  const expected = digest.digest('hex');
  const encoded = gzipSync(JSON.stringify(payloadFiles.map(file => file.path))).toString('base64');
  return `const cacheFilePaths = JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(encoded)}, 'base64')).toString('utf8'));
function isExtractedRootReady(cacheRoot) {
  try {
    const marker = JSON.parse(readFileSync(path.join(cacheRoot, '.payload-ready.json'), 'utf8'));
    if (marker.payloadSha256 !== payloadSha256) return false;
    const digest = createHash('sha256');
    for (const relativePath of cacheFilePaths) {
      const target = resolveFilePath(cacheRoot, relativePath);
      const info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink()) return false;
      const data = readFileSync(target);
      digest.update(JSON.stringify([relativePath, data.length])).update(data);
    }
    return digest.digest('hex') === ${JSON.stringify(expected)};
  } catch {
    return false;
  }
}`;
}
