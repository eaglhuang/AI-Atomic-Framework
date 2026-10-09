/** In-memory store slices (HOT). */
export type State = { users: string[]; orders: number[]; meta: Record<string, string> };

// <region:reducers>
export function reduceUsers(state: State, user: string): State {
  return { ...state, users: [...state.users, user] };
}
// </region:reducers>

// <region:selectors>
export function selectUserCount(state: State): number {
  return state.users.length;
}
// </region:selectors>

// <region:actions>
export function createOrder(state: State, id: number): State {
  return { ...state, orders: [...state.orders, id] };
}
// </region:actions>

export const initialState: State = { users: [], orders: [], meta: {} };
