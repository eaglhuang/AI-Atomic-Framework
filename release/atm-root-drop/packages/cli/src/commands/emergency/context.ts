let taskflowOperatorDepth = 0;

export function isTaskflowOperatorLaneActive(): boolean {
  return taskflowOperatorDepth > 0 || process.env.ATM_TASKFLOW_OPERATOR_LANE === '1';
}

export async function withTaskflowOperatorLane<T>(callback: () => Promise<T>): Promise<T> {
  taskflowOperatorDepth += 1;
  const previous = process.env.ATM_TASKFLOW_OPERATOR_LANE;
  process.env.ATM_TASKFLOW_OPERATOR_LANE = '1';
  try {
    return await callback();
  } finally {
    taskflowOperatorDepth -= 1;
    if (previous === undefined) {
      delete process.env.ATM_TASKFLOW_OPERATOR_LANE;
    } else {
      process.env.ATM_TASKFLOW_OPERATOR_LANE = previous;
    }
  }
}
