import type { EntityRef } from '@sdris/shared-kernel';
import type { SyntheticPrincipal } from './synthetic-issuer';

/**
 * Synthetic test principals with fixed, valid UUIDv7 ids (deterministic across runs). Excluded from the production
 * build (`**\/*.fixtures.ts` in tsconfig.build.json) and importable only from recognised test files and the
 * identity module. They carry no credential: tests ask the issuer for a handle by principal key.
 */
const actor = (id: string): EntityRef<'Actor'> =>
  ({ entityType: 'Actor', id }) as EntityRef<'Actor'>;

export const FIXTURE_HUMAN_ID = '0190a5b0-0000-7000-8000-00000000f001';
export const FIXTURE_SYSTEM_ID = '0190a5b0-0000-7000-8000-00000000f002';

export const syntheticPrincipalsFixture: readonly SyntheticPrincipal[] = [
  {
    key: 'fixture-engineer',
    actor: actor(FIXTURE_HUMAN_ID),
    actorKind: 'HUMAN',
    permissions: [
      'investigation.uut.register',
      'investigation.attempt.register',
      'investigation.case.open',
      'investigation.case.link_attempt',
      'investigation.read',
    ],
  },
  {
    key: 'fixture-reader',
    actor: actor('0190a5b0-0000-7000-8000-00000000f003'),
    actorKind: 'HUMAN',
    permissions: ['investigation.read'],
  },
  {
    key: 'fixture-automation',
    actor: actor(FIXTURE_SYSTEM_ID),
    actorKind: 'SYSTEM',
    permissions: ['investigation.attempt.register', 'investigation.read'],
  },
];
