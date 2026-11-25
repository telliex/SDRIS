/**
 * The closed permission vocabulary of S0-06 (specification 3.1): flat grants, no hierarchy, resource rules or
 * delegation. Permissions do not mean readiness or approval of any engineering conclusion (AGENTS.md section 8).
 * The issuer builds every principal's permission set from this vocabulary and refuses anything else.
 */
export const PERMISSIONS = [
  'investigation.uut.register',
  'investigation.attempt.register',
  'investigation.case.open',
  'investigation.case.link_attempt',
  'investigation.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const known: ReadonlySet<string> = new Set(PERMISSIONS);
export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && known.has(value);
