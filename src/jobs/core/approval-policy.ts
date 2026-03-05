import { config } from '../../config.js';

export type JobRiskTier = 0 | 1 | 2;

export type JobApprovalDecision = {
  tier: JobRiskTier;
  requiresApproval: boolean;
  reason: string;
};

const HIGH_RISK_NAMES = new Set([
  'devops:restart-discord-service',
  'devops:full-self-refresh',
]);

export function classifyJobRisk(name: string, timeoutMs?: number): JobRiskTier {
  if (HIGH_RISK_NAMES.has(name)) return 2;

  const t = typeof timeoutMs === 'number' ? timeoutMs : 0;

  // Deep loops are medium by default; very long loops are high-risk.
  if (name === 'agent:autonomous-deep-loop' || name === 'agent:codex-high-review' || name.startsWith('devops:agent-loop')) {
    if (t >= 1000 * 60 * 60) return 2;
    return 1;
  }

  // Builds/self-checks/reviews are safe enough to auto-run.
  if (name === 'coderabbit-review' || name === 'devops:build' || name === 'devops:self-check' || name === 'devops:self-update') {
    return 0;
  }

  return 1;
}

export function getApprovalDecision(name: string, timeoutMs?: number): JobApprovalDecision {
  const mode = config.JOB_APPROVAL_MODE;
  if (mode === 'off') {
    return { tier: classifyJobRisk(name, timeoutMs), requiresApproval: false, reason: 'approval mode off' };
  }

  const tier = classifyJobRisk(name, timeoutMs);
  if (mode === 'strict') {
    return { tier, requiresApproval: tier >= 1, reason: 'strict mode: tier 1/2 requires approval' };
  }

  // tiered (default): only tier 2 requires explicit approval
  return {
    tier,
    requiresApproval: tier >= 2,
    reason: tier >= 2 ? 'tiered mode: high-risk job requires approval' : 'tiered mode: auto-approved',
  };
}
