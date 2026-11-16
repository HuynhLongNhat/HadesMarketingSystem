/**
 * A Department workflow creates all of its AI Tasks up front, but only the
 * current step is allowed onto BullMQ. This marker keeps later steps out of
 * generic queued-task recovery until `advanceTask` explicitly releases them.
 */
const WAITING_PREFIX = "department-workflow:waiting:";

export function departmentWorkflowWaitingToken(runId: string, sequence: number) {
  return `${WAITING_PREFIX}${runId}:${sequence}`;
}

export function isDepartmentWorkflowWaitingToken(value: string | null) {
  return typeof value === "string" && value.startsWith(WAITING_PREFIX);
}

/** A later step must have received the persisted output of its direct predecessor. */
export function isReleasedDepartmentStep(input: {
  sequence: number;
  description: string;
  previousStepStatus?: string;
}) {
  if (input.sequence === 1) return true;
  return input.previousStepStatus === "completed"
    && input.description.includes(`--- OUTPUT BƯỚC ${input.sequence - 1} `);
}
