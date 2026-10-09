/** HTTP route table (HOT). */
export type Handler = (req: { path: string }) => { status: number; body: string };

// <region:users>
export const usersRoutes: Record<string, Handler> = {
  'GET /users': () => ({ status: 200, body: '[]' }),
  'POST /users': () => ({ status: 201, body: '{}' }),
};
// </region:users>

// <region:orders>
export const ordersRoutes: Record<string, Handler> = {
  'GET /orders': () => ({ status: 200, body: '[]' }),
};
// </region:orders>

// <region:admin>
export const adminRoutes: Record<string, Handler> = {
  'GET /admin/health': () => ({ status: 200, body: 'ok' }),
};
// </region:admin>

export function allRoutes(): Record<string, Handler> {
  return { ...usersRoutes, ...ordersRoutes, ...adminRoutes };
}
