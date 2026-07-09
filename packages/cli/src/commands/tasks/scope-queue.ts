export {
  runTasksRosterUpdate
} from './legacy-impl.ts';

export const scopeQueueAtomBoundary = {
  owner: 'atm.tasks-command.scope-queue',
  commands: [
    'tasks scope add',
    'tasks scope repair',
    'tasks queue status',
    'tasks queue abandon',
    'tasks parallel',
    'tasks lock cleanup',
    'tasks roster update'
  ]
} as const;
