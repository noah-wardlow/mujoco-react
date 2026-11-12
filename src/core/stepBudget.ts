export interface PhysicsPerformance {
  steps: number;
  physicsMs: number;
  realTimeFactor: number;
  backlogSteps: number;
  budgetExceeded: boolean;
}
/** A single mj_step cannot be preempted; always finish it, then yield. */
export function runStepBudget(requested: number, step: () => void, budgetMs = 8, now = () => performance.now()) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('physicsBudgetMs must be positive and finite');
  const start = now();
  let steps = 0;
  while (steps < requested && steps < 100) {
    step(); steps++;
    if (now() - start >= budgetMs) break;
  }
  return { steps, physicsMs: now() - start, budgetExceeded: steps < requested };
}
