/** App config (HOT) — writable via ATM WriteIntent bounded regions. */
export interface DbConfig { host: string; port: number; name: string }
export interface CacheConfig { ttlSec: number; backend: 'memory' | 'redis' }
export interface FeatureFlags { billingV2: boolean; experimentalSearch: boolean }

// <region:db>
export const dbConfig: DbConfig = {
  host: 'localhost',
  port: 5432,
  name: 'app',
};
// </region:db>

// <region:cache>
export const cacheConfig: CacheConfig = {
  ttlSec: 60,
  backend: 'memory',
};
// </region:cache>

// <region:flags>
export const featureFlags: FeatureFlags = {
  billingV2: false,
  experimentalSearch: false,
};
// </region:flags>
