/** App entry (COLD). */
import { dbConfig, featureFlags } from './config.ts';
import { allRoutes } from './routes.ts';
import { initialState } from './store.ts';

// <region:body>
export function boot(): { ok: true; routes: number; db: string } {
  const routes = allRoutes();
  return {
    ok: true,
    routes: Object.keys(routes).length,
    db: `${dbConfig.host}/${dbConfig.name}`,
  };
}

export function isBillingV2(): boolean {
  return featureFlags.billingV2;
}

export { initialState };
// </region:body>
