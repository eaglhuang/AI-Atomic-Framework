import { dispatchTasksAction } from '../command-dispatch.js';
export async function runTasksCompatCommandMap(argv, handlers) {
    return dispatchTasksAction(argv, handlers);
}
