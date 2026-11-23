# S0-06 — Authentication and Audit Foundation (Specification v0.4, DRAFT)

**Status:** DRAFT, an **Owner Approval Candidate** after two independent architecture reviews (the first: REVISE, 1 BLOCKER, 5 MAJOR, 2 MINOR; the second remediation verification: REVISE). **Not approved. S0-06 implementation is NOT STARTED.** Everything below is a proposal built on the directions C1 to C10 of the [decision register](S0-06-owner-decision-register.md); no decision in it is formally approved.

- **Date:** 2026-11-22.
- **Reviewed baseline (pinned):** `main` at `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21` (documents reviewed at branch HEAD `24b73c8`). **Integration base (Owner-approved SHA):** the reviewed baseline is **not** the integration base by default. Each package is cut from an **integration SHA that the Owner approves in the written implementation authorization** (register section 8). Before the branch is cut the implementer verifies that `ae7dc51` is an ancestor of the approved SHA (`git merge-base --is-ancestor ae7dc51 <approved SHA>`), that the approved SHA is an ancestor of, or equal to, the current `origin/main` tip, and diffs the files this specification names (`investigation-service.ts`, the ports, `persistence-handle.ts`, `unit-of-work.ts`, `dependency-matrix.json`, migrations) between `ae7dc51` and the approved SHA. Any difference, and any movement of `origin/main` since the approval, is reported to the Owner, who re-approves or confirms in writing before the branch is cut. "`main` is unchanged" and "cut from the current main" are never assumed.
- **Not in the repository:** the Sprint 0 Blueprint. Scope below is derived from the Owner directions and the title (decision D1).
- **Revision note (v0.2 to v0.3):** replaced the audit-adapter integration with the existing `PersistenceHandle`/`executorOf` design; made the actor contract an opaque issuer-verified handle; added production isolation, audit activation/recovery, record integrity, the Security Log contract, the full FU-3 contract and the A5 amendment draft. Findings are traced in the [remediation matrix](../reviews/S0-06-review-remediation.md).
- **Revision note (v0.3 to v0.4):** one canonical order of checks (2.7: Authentication → Correlation Validation → Authorization → Domain Validation → Transaction); a typed resolver outcome, 15-minute TTL and `now >= expiresAt` expiry (2.4); the Result-based authenticated read contract (3.3); the actual bootstrap entrypoint, paired startup tests and fixture exclusion (3.2); the transaction-token contract without claiming handle-to-token provenance (4.2); trusted provenance and allowlists for `source`, `correlationId`, `causationId` and `details` (4.6); the logging layer, retention and OBL-AUD-1 (4.7); an operational cutover and recovery procedure with unknown-outcome handling (6); both shapes of the existing `concurrency_conflict` and exact FU-3 tests (7); acceptance criteria with an owning package each (8). Finding status is tracked in the [remediation matrix](../reviews/S0-06-review-remediation.md); **a finding is not resolved because a document says so.**

## 1. Objectives and scope

**Proposed objective:** every state change the Investigation context commits is attributable to a trusted actor, is authorised, and leaves exactly one authoritative audit record written atomically with the change. Closing FU-3 (validation of `expectedVersion`, version exhaustion) is in scope because it changes the same command, and it is delivered **first and on its own** (WP-01) before any audit integration.

**In scope (proposed):** a synthetic identity and trusted actor handle; a minimal permission model; an Investigation-owned audit writer, port and table; atomic state-plus-audit writes; FU-3 option B; a Security Log contract for rejected operations.

**Out of scope:** real authentication, HTTP endpoints and DTOs, audit for any other context, a shared audit context, outbox and inbox, audit read APIs, retention automation, a security-event database table, S0-07 and later work. FU-1, FU-2 and FU-4 stay separately tracked and unscheduled; OBL-SEC-1 stays a production-deployment obligation and is not a gate.

### 1.1 Existing commands (verified in `modules/investigation/src/application/investigation-service.ts` at `ae7dc51`)

| Command               | Input                                           | Effect                                                                                                        | Result on success                              | Mutation semantics                                               |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `registerUut`         | `{ serialNumber?, hostname? }`                  | Inserts a UUT with a new UUIDv7 and `createdAt = deps.now()`                                                  | `Result<Uut, …>`                               | Always creates; no uniqueness (Q3)                               |
| `registerTestAttempt` | `{ uutId, stage, externalExecutionReference? }` | Validates stage, requires the UUT, inserts an attempt (`registeredAt`)                                        | `Result<TestAttempt, …>`                       | Always creates                                                   |
| `openCase`            | `{ uut: UutRef }`                               | Requires the UUT, inserts a case, `version = 1`, `openedAt`                                                   | `Result<InvestigationCase, …>`                 | Always creates                                                   |
| `linkAttempt`         | `{ caseId, attemptId, role, expectedVersion }`  | Validates role, loads case and attempt, same-UUT, compares version, inserts link and bumps version atomically | `Result<LinkResult, …>` (`created` true/false) | New link, or no-op for an identical link at the matching version |

None takes an actor or correlation identifier and none writes audit data. Reads (`getUut`, `getTestAttempt`, `getCase`) run without a transaction (policy in 3.3).

## 2. Synthetic identity and the actor trust contract

Alternatives and trade-offs are in the [contract review](../reviews/S0-06-contract-design-review.md) sections 3 and 4.

### 2.1 Trust boundary

```text
 caller (api request, test, future worker)         trusted issuer (apps/api composition)        Investigation
 ────────────────────────────────────────         ───────────────────────────────────────      ─────────────────────
 asks for a handle with a principal key   ──────>  verifies; derives claims; mints ActorHandle
 holds ONLY the opaque handle             <──────  (claims stay inside the issuer)
 passes { actor: handle, correlationId }  ─────────────────────────────────────────────────>  resolves handle through the
                                                                                               injected ActorResolver port
```

- The **issuer** is the only code that creates handles and the only holder of claims. It lives under `apps/api/src/composition/identity/**`, which is already an approved composition-root path in `dependency-matrix.json`; **no allowlist entry is added or widened.** Rules that restrict who may import it are new restrictions, covered by executable checker tests in WP-02 (a restriction is not an allowlist widening, but the Owner reviews it as part of D3).
- **Investigation never verifies credentials.** It owns only the contract: an `ActorHandle` type and an internal `ActorResolver` port with the typed outcome of 2.4, implemented by the issuer and injected through the module composition option `actorResolver`. The service factory refuses to be built without it, so no composition can forget authentication.

### 2.2 Opaque verified Actor Handle

An `ActorHandle` is a frozen object with **no members**, created by the issuer and registered in an issuer-private `WeakMap` (the same pattern as `PersistenceHandle` in `infrastructure/database/src/persistence-handle.ts` and `TransactionContext` in `unit-of-work.ts`). It carries no claims, so a caller cannot read or alter them. Anything else passed as a handle (a plain object with `permissions`, a copy, a handle from another issuer, `null`) is not in the registry and is rejected as unauthenticated.

### 2.3 Issuer-private canonical claims

Claims are created once at issuance from the issuer's fixed principal table and never from caller input:

| Claim                   | Rule                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`                 | `EntityRef { entityType: 'Actor', id }`, `id` a **fixed, valid UUIDv7 literal** per synthetic principal (deterministic across runs; checked by `isEntityId`); no Actor table, no foreign key |
| `actorKind`             | `HUMAN` or `SYSTEM`, a field of the principal table entry. It is never derived from a credential string, a name pattern or a caller argument                                                 |
| `permissions`           | A frozen, sorted, de-duplicated array of strings from the closed permission vocabulary in 3.1, built at issuance. No nested objects, no maps, no getters, no caller-owned references         |
| `issuedAt`, `expiresAt` | From the issuer's trusted clock (below)                                                                                                                                                      |

`resolve(handle)` returns a **fresh, deep-frozen copy** each time, so the service cannot mutate registry state and no caller-held object aliases it. The service uses the copy for one command and never stores it.

### 2.4 Resolver outcome, trusted clock, expiry, revocation and reuse

The Investigation application layer defines an **internal** resolver port (not exported from `src/public`). It returns a typed outcome, never a boolean, so the cause of a failure is kept for the Security Log and hidden from the caller.

```ts
interface VerifiedActor {
  readonly actor: EntityRef<'Actor'>; // fixed UUIDv7 id (2.3)
  readonly actorKind: 'HUMAN' | 'SYSTEM';
  readonly permissions: readonly string[]; // frozen, sorted, closed vocabulary
}
type ActorResolution =
  | { readonly status: 'valid'; readonly actor: VerifiedActor }
  | { readonly status: 'missing' } // handle is undefined or null
  | { readonly status: 'invalid' } // not in this issuer's registry: forged, plain object, wrong type, or issued by another issuer
  | { readonly status: 'expired' }
  | { readonly status: 'revoked' };
interface ActorResolver {
  resolve(handle: unknown): ActorResolution;
}
```

- **Evaluation order inside `resolve`:** missing, then invalid, then revoked, then expired, then valid. A forged handle and a handle from a foreign issuer are **indistinguishable by design** (both are simply absent from this issuer's private registry); both are `invalid`.
- **Public mapping:** every non-`valid` outcome becomes the same returned `investigation.unauthenticated` with no details. The status is recorded only in the Security Log (4.7) as `missing_handle`, `invalid_handle`, `revoked_handle` or `expired_handle`.
- **Trusted clock and TTL:** the issuer receives its clock by injection from the composition root; callers never supply "now". Proposed handle TTL: **15 minutes** (Owner-proposed value, Pending Formal Approval). `expiresAt = issuedAt + 15 minutes`. A handle is expired when **`now >= expiresAt`**: at exactly `expiresAt` it is already expired; one millisecond earlier it is valid.
- **Revocation:** `issuer.revoke(handle)` is idempotent, takes effect at the next `resolve`, and is permanent (a revoked handle never becomes valid again; a new handle must be issued). It does not interrupt a command already past its authentication check.
- **Reuse:** a handle is reusable for any number of commands until it expires or is revoked. There is no renewal and no sliding window. A handle is process-local, not serialisable, and must not be logged, stored or sent across a process boundary. Per-request issuance is the recommended use.
- **When it is checked:** once per command, before the transaction is created (2.7). A transaction already running is not interrupted; this is a stated limit.
- **Security events:** exactly **one emission attempt** of one Security Log event per rejected call (with a functioning sink, exactly one **observed** event), for the first failing check only (the call returns there, so later checks never run and cannot add a second event). Accepted calls emit none (the audit record is the success evidence).

### 2.5 Human and System actors

Two kinds in the one `actorKind` field. A System actor is an automation principal (for example a test harness). **AI is not a privileged kind:** an AI-originated request is a System actor with only the permissions its principal entry lists, and none that imply approval authority (CLAUDE.md section 8, "AI recommendations cannot bypass human approval").

### 2.6 Request context and correlation provenance

The first argument of every Stage 2 command and read is `context: RequestContext = { actor: ActorHandle; correlationId: CorrelationId }`. `correlationId` is **not** an authority claim and is not trusted: it is a label created or propagated by the composition layer at request entry and validated by the Investigation service against the strict format in 4.6 (stricter than the Shared Kernel pattern). The audit writer never generates one. Provenance of `source`, `causationId` and the per-action details is in 4.6.

### 2.7 Canonical order of checks (the single source for every document)

**Authentication → Correlation Validation → Authorization → Domain Validation → Transaction**, and then the existing FU-3 order inside the transaction:

| Order   | Check                                                                                                      | Where                  | Rejection (returned value)                                            | Security event |
| ------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------- | -------------- |
| A1      | Authentication (`resolve` the handle)                                                                      | Before the transaction | `investigation.unauthenticated`                                       | yes (one)      |
| A2      | Correlation validation (`context` shape, `correlationId`)                                                  | Before the transaction | `investigation.invalid_request_context`                               | yes (one)      |
| A3      | Authorization (permission present)                                                                         | Before the transaction | `investigation.permission_denied`                                     | yes (one)      |
| D       | Domain validation that needs no I/O: `linkAttempt` role; `registerTestAttempt` stage                       | Before the transaction | `investigation.invalid_link_role`, `investigation.invalid_test_stage` | no             |
| T       | **Transaction opens**                                                                                      |                        |                                                                       |                |
| 2 to 10 | Case, attempt, same-UUT, runtime `expectedVersion`, version comparison, duplicate, exhaustion, save, audit | Inside the transaction | see 7.2                                                               | no             |

`D` runs before the transaction in Stage 2 (and as the first step inside it in Stage 1); the observable order is identical because the check is pure and writes nothing. Reads follow A1, A2 and A3 and then read without a transaction. **Runtime `expectedVersion` validation is not in `D`:** it stays after the same-UUT step (FU-3, Option B), because an invalid `expectedVersion` on a missing case must still return `case_not_found`.

### 2.8 Direct Application Service calls

Every check above is inside the service. A test, a script or a future worker that calls `service.linkAttempt(...)` or `service.getCase(...)` gets the same checks as an HTTP request. TypeScript requires the `context` argument; a JavaScript caller that omits or forges it is rejected at runtime (A1 or A2). HTTP validation or an `apps/api` guard may be added later as defence in depth, never as the only control.

### 2.9 Failures

`investigation.unauthenticated` is a returned error value (never thrown) with no detail on the cause. `investigation.invalid_request_context` carries `{ field: 'context' | 'correlationId' }`. `investigation.permission_denied` carries `{ requiredPermission }` only. None of them opens a transaction, writes a row or an audit record. Refusals by the issuer, before any handle exists, are covered by 2.10.

### 2.10 Issuer-level refusals (before any handle or service call exists)

The service cannot log a request that is refused **before** it ever receives a handle: a request to the issuer for an unknown principal, a forbidden synthetic issuance, or (once S0-07 adds HTTP) a bad credential. These refusals are logged by the **issuer**, not by the service.

- **Typed outcome.** `issuer.issue(principalKey)` returns `{ status: 'issued'; handle } | { status: 'refused'; reason: 'unknown_principal' | 'invalid_credential' }`; it does not throw for a bad request. In Phase 1 only `unknown_principal` is reachable; `invalid_credential` is reserved for S0-07 so the contract does not change later (Phase 1 has no credentials, 3.2). A construction-time refusal (`synthetic_forbidden`, 3.2) is **thrown** as `SyntheticIdentityForbiddenError` after its event.
- **Event.** `security.issuance_refused` with the closed reasons `unknown_principal`, `invalid_credential`, `synthetic_forbidden`. Fields: `event`, `at` (the issuer's trusted clock), `origin` (`issuer`), `reason`. It **never** contains the supplied principal key, a credential, an environment value, a stack trace or any other caller- or environment-controlled text, and it has no `correlationId` (no request context exists yet).
- **Emission.** The issuer receives the same security-event sink that the composition root gives the Investigation `SecurityLog` adapter, as a plain injected function `(event) => void`. The issuer therefore imports nothing from Investigation internals and no import rule or allowlist changes.
- **Exactly one emission attempt per refusal.** The issuer stops at the first failing check, so each refused call or failed construction makes exactly one emission attempt; with a functioning sink that is exactly one **observed** event, and with a failing sink the attempt still happens once and 4.7 governs the failure. A successful issuance produces none. `revoke` of an unknown or already revoked handle is idempotent and is not a refusal: no event.
- **Sink failure.** The rule of 4.7 applies: the refusal stands (returned or thrown), the sink failure is reported best-effort to standard error and counted, and a sink failure never masks the `synthetic_forbidden` throw.

**Tests (WP-02, unit level, with a capturing sink):**

1. An unknown principal key: `status: 'refused'`, no handle, **exactly one** observed event (one emission attempt) with `reason: 'unknown_principal'`, and the serialized event does not contain the key text.
2. A known principal key: `status: 'issued'`, **zero** events.
3. Each forbidden environment value of 3.2: the construction throws `SYNTHETIC_IDENTITY_FORBIDDEN` and exactly one `synthetic_forbidden` event was emitted per attempt.
4. A throwing sink: the outcome of each of the above is unchanged, the issuer made exactly **one emission attempt** per refusal, and the standard-error fallback is called once per attempt.
5. N refused calls produce N events (no coalescing, no duplicates).
6. `revoke` of an unknown handle: zero events.

## 3. Authorization, production isolation, reads

### 3.1 Permission model (proposed)

| Permission                        | Command               |
| --------------------------------- | --------------------- |
| `investigation.uut.register`      | `registerUut`         |
| `investigation.attempt.register`  | `registerTestAttempt` |
| `investigation.case.open`         | `openCase`            |
| `investigation.case.link_attempt` | `linkAttempt`         |
| `investigation.read`              | the three reads (3.3) |

Flat grants from the principal table; no hierarchy, resource rules or delegation. A missing permission returns `investigation.permission_denied` with `details: { requiredPermission }` only. Permissions do not mean readiness or approval of any engineering conclusion (AGENTS.md section 8).

### 3.2 Production isolation and synthetic startup

**Verified composition facts (at `ae7dc51`).** `apps/api/src/main.ts` bootstraps only the Nest `AppModule` (a health controller); it does **not** call the Investigation composition. The only approved importer of `@sdris/investigation/composition` is the path glob `apps/api/src/composition/**`, and the actual composition entrypoint is `composeInvestigation(connection)` in `apps/api/src/composition/investigation.composition.ts`; the compiled-runtime test loads it from `apps/api/dist/composition/investigation.composition.js`. **The approved bootstrap entrypoint for this design is therefore `composeInvestigation`**, not `main.ts`. Wiring `main.ts` to call it (and so making a process exit before `listen`) is a separate step that S0-06 does not include unless the Owner asks; every statement below about "startup" refers to the composition entrypoint, and a process-level exit is claimed only after `main.ts` is wired.

| Topic                                    | Proposed rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted environment configuration source | One function in the identity module reads the process environment once and returns a `TrustedEnvironment`. The issuer and `composeInvestigation` accept only that value, never a caller-supplied string                                                                                                                                                                                                                                                                                                                                         |
| Fail closed                              | The synthetic issuer is permitted only on a **positive** match: `SDRIS_ENV` is exactly `local` or `test`, `NODE_ENV` is not `production`, and the database target passes `assertDisposableLocalTarget`. A missing, empty, misspelt or conflicting value is refused; the default is refusal. A negative check (`NODE_ENV !== 'production'`) alone would pass when the variable is unset                                                                                                                                                          |
| Production refusal                       | `composeInvestigation` throws `SyntheticIdentityForbiddenError` (`code = 'SYNTHETIC_IDENTITY_FORBIDDEN'`) before it builds the module. No production issuer exists in S0-06, so **composing Investigation in a production environment is refused outright** (no authentication means no writes). A production issuer is a separate Owner-approved task                                                                                                                                                                                          |
| Credentials                              | Phase 1 has no HTTP and **no credential strings at all**; tests obtain handles by principal key. **Any earlier recommendation of static synthetic tokens is withdrawn.** When S0-07 adds HTTP, a credential is generated per process from a cryptographic random source, held in memory only, never logged or committed, and invalid after restart                                                                                                                                                                                              |
| Fixture principals                       | The issuer has **no built-in principals**: `createSyntheticIssuer({ environment, clock, principals })` takes them as a required argument. Test principals live in a file excluded from the production build, proposed `apps/api/src/composition/identity/synthetic-principals.fixtures.ts`, by adding `**/*.fixtures.ts` to the `exclude` list of `apps/api/tsconfig.build.json` (a build-configuration change in WP-02, not an allowlist change). The compiled-runtime test builds its own principal at run time with a random `newEntityId()` |
| Authorized fixture access                | Fixtures and `issue(principalKey)` are importable only from `*.test.*`, `*.spec.*`, `__tests__/` files and the identity module, enforced by a checker rule (WP-02) in the style of Amendment A3. No `testOnlyEntrypoints` or `compositionRoots` change is proposed; if a rule needs one, it is a separate Owner proposal                                                                                                                                                                                                                        |
| Issuer import restrictions               | Outside `apps/api/src/composition/**` and recognised test files nothing may import the issuer; `modules/investigation/**` may not import the identity module (it sees only `ActorHandle` and `ActorResolver`)                                                                                                                                                                                                                                                                                                                                   |
| Worker composition                       | `apps/worker` is not an approved composition root (A2.7, dependency matrix): it can neither import the issuer nor the Investigation composition entrypoint. A future worker mutation needs a separate Owner proposal for a worker System principal                                                                                                                                                                                                                                                                                              |

**Startup verification (two paired tests, WP-02 for the logic and WP-06 for the compiled form).**

1. **Positive:** in the compiled-runtime child (plain Node, `apps/api/dist`, real PostgreSQL, disposable database), with `SDRIS_ENV=test`, `composeInvestigation` succeeds, an ephemeral principal obtains a handle, and one command succeeds. This proves that every other dependency is present.
2. **Negative:** the **same** compiled code, database and principal list with only the environment changed (`NODE_ENV=production`; `SDRIS_ENV` unset, empty, `prod`, `Test`, conflicting) must throw an error whose **`code` is `SYNTHETIC_IDENTITY_FORBIDDEN`** (asserted on the code, not the message), before any query. Because the positive control passes in the identical setup, the refusal cannot be caused by a missing dependency.
3. **Packaging:** after `pnpm build`, `apps/api/dist` contains no `*.fixtures.js` file and none of the fixture principal id literals, and no credential-like literal.

Limit: an environment variable is a configuration source, not a boundary against someone who controls the process. The rule prevents accidental and mispackaged use, not a hostile operator.

### 3.3 Authenticated reads (Owner-proposed direction; breaking contract not approved)

The Owner's proposed direction is that Investigation reads require authentication in S0-06 Stage 2. This is recorded as direction **C11** in the decision register. It changes the S0-05 read signatures, so it is **not treated as approved** until the Owner confirms it (D3 and D8). Stage 1 (FU-3) leaves the reads unchanged.

**Why reads need an error contract.** Today the reads return `Promise<X | undefined>`: there is no place for a rejection. Operational failures elsewhere in the service are **returned as `Result` values** and only unexpected failures are thrown (specification 1.1 and the `InvestigationServiceError` documentation).

| Option                                                    | Trade-offs                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Result-based** (recommended)                         | Consistent with the writes; rejection is a value the caller must handle; not-found stays `ok(undefined)`; every read call site changes                               |
| B. Exception-based (`throw UnauthenticatedError`)         | Smaller diff at call sites that ignore errors; mixes "expected rejection" with "unexpected failure", forces `try/catch`, and is inconsistent with the write contract |
| C. Keep `X \| undefined` and return `undefined` on denial | Hides the cause, makes "not found" and "not allowed" indistinguishable and is unsafe for callers that treat `undefined` as "create it". Rejected                     |

**Recommendation: A.** Proposed Stage 2 signatures (exact):

```ts
// public contract additions
export interface RequestContext {
  readonly actor: ActorHandle;
  readonly correlationId: CorrelationId;
}
export type AccessError =
  | SdrisError<'investigation.unauthenticated', undefined>
  | SdrisError<'investigation.invalid_request_context', { readonly field: 'context' | 'correlationId' }>
  | SdrisError<'investigation.permission_denied', { readonly requiredPermission: string }>;

// reads (permission `investigation.read`; not audited; no transaction)
getUut(context: RequestContext, id: UutId): Promise<Result<Uut | undefined, AccessError>>;
getTestAttempt(context: RequestContext, id: TestAttemptId): Promise<Result<TestAttempt | undefined, AccessError>>;
getCase(context: RequestContext, id: InvestigationCaseId): Promise<Result<InvestigationCase | undefined, AccessError>>;

// writes: same commands with `context` first; InvestigationServiceError gains AccessError
registerUut(context: RequestContext, command: {...}): Promise<Result<Uut, InvestigationServiceError>>;
// registerTestAttempt, openCase and linkAttempt likewise
```

Absence stays `ok(undefined)`: "not found" is not an access error, and the existing semantics are preserved. Reads write no audit record (no state change; read auditing is out of scope and stated as a gap). Exposure: the reads are reachable only through the service object returned by the approved composition root.

**If the Owner defers read authentication (the alternative; not recommended).** The reads keep today's signatures (`X | undefined`) in Stage 2, and the following **exposure boundary** replaces the authentication check:

1. **Read-only facade, constructed explicitly.** The composition root builds a **new object** that holds exactly the three read methods (`getUut`, `getTestAttempt`, `getCase`) and hands out only that object, typed as `InvestigationReads`. A TypeScript `Pick` alone is **not** enough: it is a compile-time view and leaves the write methods on the runtime object, so the facade is a separately constructed object, not a narrowed reference to the service. The full service (whose write commands authenticate themselves) is never given to code that only needs reads.
2. **Who may receive it.** Only (a) code under `apps/api/src/composition/**` that created it, (b) in-process callers that composition code passes the facade to explicitly, and (c) recognised test files. **No HTTP controller, no worker and no other module may receive it** until S0-07 and a read-authentication decision exist, so Phase 1 exposes no read over any network interface.
3. **What enforces it.** An import allowlist does not constrain where an already-created object is passed, so the controls are the facade type, review, and two tests (below), not an import rule. No architecture-checker change is proposed.
4. **Accepted limit.** Unauthenticated in-process reads of serial numbers and hostnames are tolerable only because Sprint 0 data is synthetic (CLAUDE.md section 13); the gap is recorded and must be closed before any real data.

**Tests if deferred (WP-03):** (a) the composition returns a facade whose own enumerable keys are exactly the three reads, with none of the four write command names, and whose prototype is `Object.prototype`, so it holds no link to the service (type test plus a runtime check); (b) a test of the API `AppModule` asserts that no controller or provider declares a dependency on the Investigation service or facade, and fails when one is added.

**Caller inventory (by search at `ae7dc51`; every item changes in Stage 2 and none in Stage 1):**

| Caller                                                                                    | Kind                        | Change in Stage 2                                          |
| ----------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| `modules/investigation/src/application/investigation-service.spec.ts` (8 read call sites) | Direct service tests        | Add a context; handle the `Result`                         |
| `apps/api/src/composition/investigation-links.integration.test.ts` (30 sites)             | Real-PostgreSQL integration | Same                                                       |
| `apps/api/src/composition/investigation.integration.test.ts` (3 sites)                    | Real-PostgreSQL integration | Same                                                       |
| `tests/runtime/compiled-runtime.child.cjs` (8 sites)                                      | Compiled-runtime consumer   | Same; supply an ephemeral principal and handle             |
| `apps/api/src/composition/investigation.composition.ts` (`composeInvestigation`)          | Composition caller          | Gains the environment and issuer wiring; no read call site |
| `modules/investigation/src/composition/index.ts` (`createInvestigationModule`)            | Factory                     | Gains required `actorResolver`, audit and security log     |
| `tests/architecture/type-surface.test.mjs` and its fixtures                               | Type-surface verification   | Re-run; the public surface gains types                     |

(The read call sites inside `investigation-service.ts` itself are repository reads, not service reads, and do not change.)

## 4. Audit ownership, persistence and integrity

### 4.1 Components (Investigation-owned; no shared Audit Context)

| Component             | Location (proposed)                                                            | Role                                                                          |
| --------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `AuditWriter` port    | `modules/investigation/src/application/ports/audit-writer.ts`                  | `record(entry: InvestigationAuditEntry, tx: TransactionToken): Promise<void>` |
| Drizzle audit adapter | `modules/investigation/src/infrastructure/persistence/drizzle-audit-writer.ts` | The only place that touches Drizzle or SQL for audit                          |
| Audit table           | `investigation.audit_record`, migration `0003`                                 | Append-only                                                                   |
| Public contract       | `modules/investigation/src/public/index.ts`                                    | Action names, entry type, error codes: contracts only                         |

### 4.2 Persistence contract: the existing `PersistenceHandle` design and the transaction token

This **replaces** the v0.2 text that named `executorFor(db, tx)`. The Investigation infrastructure never receives a `db` object. It receives an opaque `PersistenceHandle` (made by the composition root with `createPersistenceHandle`) and resolves an executor with `executorOf(handle, tx)`, exactly as `DrizzleInvestigationRepository` does.

- **`AuditWriter` is an internal Investigation port** (`application/ports/audit-writer.ts`); it is not exported from `src/public`. Only the service calls it.
- **Which token:** the service passes the `tx` it received **in the callback of the current `transactions.run`**, and no other. Passing a token from a different unit, an earlier unit or another module is a defect.
- **Missing token:** the adapter checks `tx !== undefined` first and throws `AuditTransactionRequiredError` otherwise. This guard is mandatory because `executorOf(handle)` with no `tx` **returns the pool executor** (`executorFor` returns `db` when `tx` is undefined), which would write audit outside the unit of work.
- **Unknown and ended tokens:** rejected by the **existing infrastructure**: `executorFor` throws `TransactionContextError('Unknown transaction context.')` for a context it did not create and `TransactionContextError('Transaction context is no longer active.')` after the unit ended. They propagate; the unit rolls back; the command throws.
- **What the infrastructure does not do (not claimed):** the registry of contexts is module-global in `unit-of-work.ts` and is keyed by the context only. `executorOf(handle, tx)` does **not** check that `tx` was issued by the same handle or the same unit of work as the one the caller thinks of, and it cannot tell a token of another **active** unit from the current one. **Handle-to-token provenance is therefore not enforced by the infrastructure.** It is guaranteed here only by construction (the service passes the callback token, nothing else) and is verified by tests (WP-05), not by a runtime check. Whether to add a provenance check to the database package is a separate proposal and is not made here.
- Drizzle, the table definition and every ORM type stay inside `src/infrastructure/**`; the port and the service mention none. A1 to A4 already allow this for `@sdris/investigation`; no checker or allowlist change is needed.

**Rollback verification (real PostgreSQL, WP-04 for the adapter and WP-05 for the service):**

1. **Real SQL failure after the link and version writes:** inside one unit the link row is inserted and the case version is bumped, and then the audit insert fails with a real database error (a violated check constraint). Afterwards the link row is absent, the case version is unchanged and no audit row exists.
2. **Failure after a successful audit insertion but before commit** (a test wrapper that calls the real adapter and then throws; and a test-only deferred constraint trigger in the disposable database that raises at `COMMIT`): neither the audit row nor the domain rows persist, and the service throws.
3. **Missing token:** the adapter throws `AuditTransactionRequiredError` and writes nothing, and the pool executor is never used (asserted by a counting executor and by the absence of the row).
4. **Unknown token:** a hand-made object cast as a token, never created by the unit of work, makes the adapter throw `TransactionContextError('Unknown transaction context.')` and writes nothing.
5. **Ended token:** a token kept after the unit completed makes the adapter throw `TransactionContextError('Transaction context is no longer active.')` and writes nothing.

**Separate-connection inspection (applies to every case above).** After the unit has completed or thrown, the assertions read the state through a **separate database connection**, opened independently of the unit of work and of the connection the unit used (for example a connection taken from the disposable database's own pool). They read **both** the domain tables, including the case version, **and** `investigation.audit_record`. The unit's own connection is never used to assert its outcome, because it could observe uncommitted state.

### 4.3 Candidate audit record

| Column                       | Type            | Source / rule                                                                               |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `audit_id`                   | uuid, PK        | `deps.newId<'AuditRecord'>()` (UUIDv7)                                                      |
| `action`                     | text, check     | One of the four actions in 4.4                                                              |
| `actor_type`, `actor_id`     | text, uuid      | The `EntityRef` of the verified actor (`Actor`, UUIDv7); no foreign key                     |
| `actor_kind`                 | text, check     | `HUMAN` or `SYSTEM`                                                                         |
| `subject_type`, `subject_id` | text, uuid      | The entity the command created or changed (4.4)                                             |
| `case_id`                    | uuid, null      | Non-null **iff** `subject_type = 'InvestigationCase'`, and then equal to `subject_id` (4.5) |
| `occurred_at`                | timestamptz     | The single injected-clock reading of the command; never a database default                  |
| `correlation_id`             | text            | From the request context (2.6); strict UUID form (4.6)                                      |
| `causation_id`, `source`     | uuid null, text | `causation_id` always null in Phase 1; `source` fixed by the composition root (4.6)         |
| `schema_version`             | integer         | `1`                                                                                         |
| `details`                    | jsonb, null     | Per-action allowlist (4.4); a database check enforces the key set                           |

`recorded_at` is omitted in Phase 1 (one clock; it would duplicate `occurred_at`).

### 4.4 Actions, subjects and allowed details (closed allowlist)

| Action                                  | `subject`                     | `case_id` | Allowed `details` keys                               | Persisted timestamp equality                                     |
| --------------------------------------- | ----------------------------- | --------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `investigation.uut_registered`          | `UUT` (the new UUT)           | null      | none (`details` null)                                | `occurred_at = uut.created_at`                                   |
| `investigation.test_attempt_registered` | `TestAttempt` (the new one)   | null      | `uutId`, `stage`                                     | `occurred_at = test_attempt.registered_at`                       |
| `investigation.case_opened`             | `InvestigationCase` (new)     | = subject | `uutId`                                              | `occurred_at = investigation_case.opened_at`                     |
| `investigation.attempt_linked`          | `InvestigationCase` (changed) | = subject | `attemptId`, `role`, `versionBefore`, `versionAfter` | `occurred_at = case_test_attempt_link.linked_at` of the new link |

**Sensitive-data allowlist:** only the identifiers and controlled values in the table (UUIDv7 ids, `stage` from `IST`/`SAT`, `role` from the four roles, integer versions). **Never** stored: serial number, hostname, `externalExecutionReference`, credentials, handles, claims, free text, error messages. `versionAfter = versionBefore + 1` is a check in the validator and in tests.

These are audit **actions**, not domain events; event publication and outbox stay deferred (ADR-025 Decision 7).

### 4.5 Subject and case relationships; foreign keys; deletion

- `case_opened` and `attempt_linked` have the case as subject, so `case_id = subject_id`. For `attempt_linked` the attempt appears in `details.attemptId`. `uut_registered` and `test_attempt_registered` have no case, so `case_id` is null. A database check states `(subject_type = 'InvestigationCase') = (case_id is not null)` and `case_id = subject_id` when set.
- **Foreign key:** `case_id references investigation.investigation_case (id)` with the default `NO ACTION`. It is satisfiable because the case row exists earlier in the same transaction for both actions. Deleting a case is not an approved operation and nothing implements it. **Future deletion policy:** deleting a case that has audit rows must be rejected, never cascaded; any case-deletion feature needs its own Owner decision about archival of the audit history before it is built. There is no foreign key on `subject_id` (it is polymorphic), on `actor_id` (no Actor table) or on ids inside `details`; their integrity comes from being written in the same transaction as the rows they name.

### 4.6 Investigation-specific validation, allowlists and provenance

`parseAuditMetadata` (Shared Kernel) validates the **generic** envelope only. The Investigation application layer adds `validateInvestigationAuditEntry`, which runs before the first write and rejects: an action outside the four; a `subject.entityType` that does not match the action; a `case_id` rule violation; a `details` key outside the allowlist, or a value outside its type or range; `versionAfter ≠ versionBefore + 1`; an invalid actor `EntityRef`; a field outside its allowlist below. A failure throws before any row is written. The database check constraints repeat the rules as defence in depth.

**Trusted provenance and allowlists for every field that did not come from the domain:**

| Field           | Provenance (who may set it)                                                                                      | Allowlist and format (validated in the service and by a database check)                                                                                                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`        | **Fixed by the composition root**, one constant per composition root (`api`); **never taken from a request**     | Closed set `api` or `test`. `worker` is not permitted (no worker composition root)                                                                                                                                                                                                                                                                                                                  |
| `correlationId` | Created or propagated by the composition layer at request entry. **Untrusted as a claim and treated as a label** | Strict form: a lowercase canonical UUID (36 characters). The Shared Kernel pattern allows 128 free characters, which could carry a serial number or hostname, so Investigation is stricter. An incoming trace id of another form is **discarded and replaced by a generated one** by the composition layer; the original is not stored. The Owner may choose another strict form, but not free text |
| `causationId`   | Set only by the composition layer when the causing command or event is known                                     | A valid UUIDv7 `EntityId`. **Phase 1: always null** (nothing supplies it); the validator rejects a non-null value until the Owner approves a use                                                                                                                                                                                                                                                    |
| `actor_*`       | Issuer-private claims only (2.3)                                                                                 | `Actor` + UUIDv7; `actor_kind` in (`HUMAN`, `SYSTEM`)                                                                                                                                                                                                                                                                                                                                               |
| `details`       | Built by the service from the domain objects it just created, never from raw command text                        | The per-action keys of 4.4, each with its own type: ids are UUIDv7, `stage` is `IST` or `SAT`, `role` is one of the four roles, `versionBefore` and `versionAfter` are integers between 1 and 2147483647                                                                                                                                                                                            |

So an untrusted trace field cannot carry arbitrary sensitive data: `source` and `causationId` are constants or null, `correlationId` is a fixed-shape identifier, and `details` is assembled only from validated identifiers and controlled vocabulary.

- **Timestamp provenance:** `deps.now()` is read **once per command** and used for the domain timestamp and `occurred_at`. In the current `linkAttempt` the clock is read once, inside `linkTestAttempt`; the implementation keeps a single reading. Test comparisons are per operation (last column of 4.4) on the **persisted** `timestamptz` values.
- **Shared Kernel** is not changed.

### 4.7 Integrity limits, database roles, Security Log and OBL-AUD-1

**What the triggers do and do not give.** `BEFORE UPDATE` and `BEFORE DELETE` row triggers (like the existing `reject_update`) plus a statement-level `BEFORE TRUNCATE` trigger stop application defects and ordinary SQL from changing audit history. They do **not** stop the table owner, a superuser, `ALTER TABLE … DISABLE TRIGGER`, `DROP TRIGGER`, `DROP TABLE`, `session_replication_role = replica`, a restored backup or file-level access. The table is **not tamper-evident**.

**Database roles (assumption for production; not enforceable locally).** The application should connect as a role with `INSERT` and `SELECT` on `investigation.audit_record` and no `UPDATE`, `DELETE`, `TRUNCATE` or DDL rights, while migrations run as a separate owner role. The local setup uses one role (`sdris_local`) that owns everything, so Phase 1 does **not** demonstrate privilege separation.

**OBL-AUD-1 (proposed production-deployment obligation; not a gate for S0-06; Pending Formal Approval).** Before any production deployment that relies on the audit table: (1) database privilege separation as above, verified by a catalogue query of effective grants for the application role; (2) restriction of DDL on the audit table and its triggers to the owner role, with a test as a non-owner role attempting `DROP TRIGGER`, `ALTER TABLE … DISABLE TRIGGER` and `TRUNCATE`, all of which must fail; (3) an Owner decision on tamper-evidence (hash chaining, external anchoring or none) recorded with its rationale. Like OBL-SEC-1 it stays open until the Owner records a disposition.

**Security Log: responsibility and contract.** Two layers log, and each logs only what it can see. **A call without a valid handle** reaches the service, which is the first code that sees every call, including direct calls with no HTTP involved: **the Investigation application service is the responsible logging layer** for `security.unauthenticated`, `security.invalid_request_context` and `security.permission_denied`. **A refusal before any handle exists** (an unknown principal key, a forbidden synthetic issuance, a bad credential) never reaches the service: **the issuer is the responsible logging layer** for `security.issuance_refused` (2.10). The service and it emits the event through an Investigation `SecurityLog` port implemented by a logger adapter that the composition root injects. A framework or transport log added later by S0-07 is separate and is not this contract. The log is a structured log, not a database table; a security-event table would need separate Owner approval.

| Aspect                | Contract                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Events                | One JSON object per rejected call, built **only** from fixed fields (never by spreading a caller object): `event`, `at` (injected clock), `command`, `reason`, and, where trustworthy, `correlationId`, `actorId`, `requiredPermission`. Refused issuances use the separate event of 2.10                                                                          |
| Event and reason sets | `security.unauthenticated` with `missing_handle`, `invalid_handle`, `revoked_handle`, `expired_handle`; `security.invalid_request_context` with `invalid_context`, `invalid_correlation`; `security.permission_denied` with `permission_missing`; `security.issuance_refused` (issuer, 2.10) with `unknown_principal`, `invalid_credential`, `synthetic_forbidden` |
| Trust per field       | `correlationId` only when it passed validation (so never on `invalid_request_context` or when authentication failed before validation ran); `actorId` and `requiredPermission` only after the actor was verified (invalid context and permission denial), never on an authentication failure                                                                       |
| Redaction             | Never logged: credentials, handles, claims, tokens, command payload values (serial number, hostname, references, caller-supplied ids), stack traces, and any caller-controlled text. An allowlist serializer is the only way to produce an event                                                                                                                   |
| Credential failures   | At the issuer: `security.issuance_refused` with a reason code only (2.10). At the service: a missing or invalid handle is `security.unauthenticated`. The caller's error never says which part failed, and the log does not distinguish "wrong secret" from "no such principal"                                                                                    |
| Access control        | Readable only by operators of the deployment; never exposed through the API or a read method. In Phase 1 the sink is the process log                                                                                                                                                                                                                               |
| Retention             | Phase 1 (synthetic): only what the process log keeps, no guarantee. For production the **Owner sets** the retention; proposal: not shorter than the retention of the audit records, so a denial can be correlated with the history it concerns                                                                                                                     |
| Sink failure          | The rejection result stands: a failing sink never turns a denial into success and never throws into the command path. The failure is reported best-effort to standard error and counted. This is acceptable only because the Security Log is non-authoritative                                                                                                     |

## 5. Audit semantics

Only a committed state change produces an authoritative audit record, and every committed state change produces exactly one.

| Case                                                                                                      | State change | Authoritative audit record  | Result                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------ | --------------------------- | ----------------------------------------------------------------------- |
| Successful create (UUT, attempt, case)                                                                    | Yes          | **One**, same transaction   | `ok`                                                                    |
| Successful new link                                                                                       | Yes          | **One** (`attempt_linked`)  | `ok`, `created: true`                                                   |
| Duplicate link at the matching version                                                                    | No           | **None**                    | `ok`, `created: false`, version unchanged                               |
| Validation failure (role, stage, not found, same-UUT, invalid `expectedVersion`, invalid request context) | No           | **None**                    | error value                                                             |
| Concurrency conflict                                                                                      | No           | **None**                    | `investigation.concurrency_conflict`, even if the identical link exists |
| Authentication or authorization failure                                                                   | No           | **None**; Security Log only | `investigation.unauthenticated` / `investigation.permission_denied`     |
| Version exhaustion                                                                                        | No           | **None**                    | `investigation.version_exhausted` for a new link at version 2147483647  |
| Transaction rollback (any cause, incl. an audit write failure)                                            | No           | **None** (nothing persists) | error value, or a thrown unexpected error                               |

A repeated create is a new state change each time (no uniqueness is approved), so each leaves its own record.

## 6. Transaction atomicity, activation and recovery

### 6.1 Atomic write

Each write command runs in one `TransactionScope.run` (existing). Inside the unit, in order: assemble and validate the audit entry (4.6) before the first write; write the domain rows; call `audit.record(entry, tx)` **only if a state change was made**, with the callback's own `tx` (4.2); commit. A failing audit insert throws; the unit rolls back; the caller gets a thrown, unexpected error. No new transaction framework, no second connection, no cross-context call. **Rollback contract:** after any rolled-back unit there is no domain row and no audit row from it; after a committed unit both exist with equal `occurred_at`.

### 6.2 Mandatory-audit cutover procedure and the write fence

A **legacy writer** is any process or credential that can write Investigation tables through a code path that does not write the audit record: the S0-05 build, any pre-WP-05 build, scripts, tests, scheduled jobs and workers. Activation is a procedure, not only a commit; the code change (WP-05) is its **identified activation point**: from that build on, `createInvestigationService` requires the audit writer, with no flag and no environment toggle.

**Why inspection is not a fence.** A `pg_stat_activity` snapshot shows who is connected **now**. It cannot stop a process restart, a reconnect, an overlapping deployment, a scheduled job or a worker from connecting a moment after the snapshot. `application_name` is a label the **client** chooses; it can be set to anything. It is an **observability aid only** (it helps an operator read `pg_stat_activity`) and **never a security boundary**: no fence decision and no cutover evidence may rest on it alone. Whether to add the instrumentation is an Owner decision (D6); the cutover does not depend on it.

**Fence mechanism F1 (required): a persistent credential and privilege fence in the database catalogue.**

1. **Dedicated writer role.** Audit-capable builds connect only as a dedicated writer role (name proposed: `sdris_investigation_writer`) that holds exactly the privileges the audited path needs: `INSERT` and the case-version `UPDATE` on the Investigation domain tables, `INSERT` and `SELECT` on `investigation.audit_record`. No other role that can log in keeps any write privilege on those tables.
2. **Legacy credentials made unusable.** Every other login role has `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` revoked on the Investigation tables, and each legacy login role is set `NOLOGIN` (or its credential is rotated) so the old connection string fails at login. Existing sessions of those roles are then ended (`pg_terminate_backend`). Because these are catalogue changes, they persist across restarts and reconnects and do not depend on timing.
3. **Table ownership.** A table owner keeps implicit privileges and can re-grant them to itself, so the tables must be owned by a **non-login migration-owner role**. The local setup has one owning role (`sdris_local`), so that split is a **precondition** of F1 (and part of OBL-AUD-1, 4.7). If it has not been done, the fence cannot be demonstrated against a legacy writer that connects as the owner and **writes stay held**.
4. **Runbook.** The exact statements, the enumeration of launch paths and the evidence to attach are a WP-05 deliverable in `docs/runbooks/` (a runbook, not code).

**Fence mechanism F2 (optional; Owner decision; stronger): database-enforced audit presence.** Deferred constraint triggers on the domain tables reject a commit unless an audit row for the same subject exists in the same transaction (for a link: an `attempt_linked` row with the case id, attempt id and role). This also stops a legacy writer that holds a **valid** credential. It adds migration complexity and interacts with the version bump, so it is **not proposed unless the Owner asks**; if chosen it is decided with D6 and delivered by migration, not by editing an applied one.

**Launch paths the fence must cover (the runbook enumerates each for the target environment and records how it is covered):**

| Path                                                     | How the fence covers it                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process restart, reconnect, overlapping deployment       | A legacy credential fails at login or with `42501` regardless of when it connects; the writer role is the only one that can write                                                                                                                                           |
| Scheduled jobs, CI jobs, scripts                         | Any job using a legacy credential is refused by the same revoke; the runbook lists each one (none is known in the repository at `ae7dc51`; the operator confirms for the target environment)                                                                                |
| Workers                                                  | `apps/worker` is not an approved composition root and cannot import the Investigation composition entrypoint (A2.7, dependency matrix). A worker connecting with a legacy credential is refused; **no writer role is issued to a worker** without a separate Owner approval |
| Administrative paths (`db:seed`, `db:reset`, migrations) | They run as the owner or migration role by design and are restricted to local and test targets by the existing safety guard (ADR-025 Decision 11). They are **outside the audit guarantee** by definition, like any owner or superuser access (OBL-AUD-1)                   |

**Procedure:**

1. **Apply and verify the schema.** Apply `0003`; verify `investigation.audit_record` (columns, checks, foreign key, the three triggers) with the verification query shared with the startup check. The table is inert.
2. **Establish F1.** Split ownership if needed, create the writer role, grant, revoke and set `NOLOGIN` as in F1. Verify with a **catalogue query** that the set of roles holding any write privilege on each Investigation table equals the writer role plus the documented bypass roles (the non-login owner and superusers). A leftover grant to any other role fails the check.
3. **Stop the legacy writers and end their sessions.** Stopping a process is operational hygiene, **not** the fence (the fence is step 2).
4. **Verify the fence negatively, after step 3.** (a) For **each enumerated legacy credential**, a connection attempt fails at login or its write to each of the four domain tables and to the case version fails with `42501`; (b) a `pg_stat_activity` snapshot shows no session of a legacy role (observability, not proof); (c) no transaction older than the activation start is open; (d) record the **baseline B**: the set of ids of every UUT, attempt and case row and the key of every link row (case id, attempt id, role) that exists **now, after the fence**.
5. **Activate the audit-capable writers** (they connect as the writer role). Each runs the startup readiness check and refuses to start if the schema is wrong.
6. **Verify before accepting writes.** (a) Readiness passed on every writer; (b) **repeat the negative fence check of step 4(a) now, after the other checks have passed**, because an old writer that reconnects after the first clean verification is the case to exclude; (c) in a synthetic environment one canary command per action, with its audit rows confirmed (production runs no canaries); (d) the completeness query (below) returns no rows.
7. **If any evidence cannot be produced, hold writes.** Do not start writers, leave the fence in place, repair and repeat from the failing step. Writes are **held** when no writer role is active (or the writer role's write grants are suspended); reads continue.
8. **Keep the fence.** F1 is persistent. Any new login role, credential, scheduled job or deployment that could write Investigation tables needs an Owner approval and a repeat of steps 2 to 4 and 6(b) before it runs.

**The completeness query is detection, not proof.** It compares domain rows with audit rows by **id and subject, not by timestamp**: every UUT, attempt and case id not in B must have an audit row with the matching action and `subject_id`, and every link key not in B must have an `attempt_linked` row with the matching `case_id` and `details.attemptId` and `role`. Persisted timestamps are **not** the criterion: they are caller-generated (the injected clock) and need not match commit time, and a legacy writer can write any timestamp, including one before the activation instant. The query can only detect unaudited rows that exist. It cannot prove that no bypass happened (a deleted row or SQL run by the owner or a superuser leaves nothing to compare), so it **supports** the fence and does **not** replace it. A row it returns is an unaudited mutation to be reconciled by an operator; audit rows are **never back-filled** to make the query clean, because a back-filled row would be false evidence.

### 6.3 Recovery (never silently restores unaudited writes)

| Situation                                      | Recovery                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An audit-capable build is faulty               | **Hold writes** (suspend the writer role's write grants or stop the writers; the legacy fence stays; reads may continue), then deploy a fixed audit-capable build and repeat steps 4 to 6 of 6.2 before accepting writes                                                             |
| Audit schema or metadata failure               | The startup check or the validator fails; writes are held; repair by **forward migration** (`0004` or later); `0003` is never edited after it has been applied anywhere shared (ADR-025 Decision 2); no down-migration is assumed                                                    |
| Restoring a pre-activation build               | **Not a recovery path.** It means lifting the legacy fence. It is permitted only with **all** of: the audit-capable writers held first, a written Owner decision, an incident record, and operator reconciliation of the gap period with the completeness query. Otherwise forbidden |
| Nothing is known about the state after a crash | Treat as "hold writes", repeat the negative fence check (6.2 steps 4(a) and 6(b)) and the completeness query, then resume                                                                                                                                                            |

### 6.4 Unknown outcomes (lost commit acknowledgment)

When the transaction may have committed but the caller saw an error or a timeout, the outcome is **UNKNOWN** (ADR-025 Decision 7: unknown outcomes are not silently treated as failures). The service throws; it does not return a failure value. The service returns an `err` **value** only after the unit was rolled back (the existing `transactional()` behaviour), so an `err` is a **known** non-commit; a thrown error or a timeout is not.

- **`linkAttempt`** is safe to replay: after a commit the version has advanced, so a replay with the old `expectedVersion` returns `concurrency_conflict`, and the caller re-reads the case and sees the link.
- **Creates** (`registerUut`, `registerTestAttempt`, `openCase`) have no natural idempotency key, and the caller does not know the server-generated id. A blind replay would create another entity and another audit row.
- **`correlationId` is a search aid, not an idempotency key.** It is chosen by the caller, may be reused, may be shared by several operations, is not unique, and the service never uses it to detect a duplicate. It yields **candidate** records, never a settled outcome.
- **A uniquely matching audit record is not proof that this create committed.** A record that matches the action, the actor, a time window and the available `details` only narrows the search. Another create can match the same way: `test_attempt_registered` (`uutId`, `stage`) and `case_opened` (`uutId`) legitimately repeat, and `uut_registered` has **no** details at all. A **unique** candidate can therefore belong to a different operation, for example when the first attempt rolled back and a later identical request committed.
- **Classification.** A create is **COMMITTED** only with **operation-specific affirmative evidence** that ties the entity to **this request**. In every other case it is **UNKNOWN**: no candidate, one candidate without such evidence, and several candidates alike. No "not committed" state exists for a create whose acknowledgment was lost, because an absent record does not prove non-commit (a transaction may still be in flight, or the search may have been defeated by a changed correlation id or a wrong window).
- **What counts as operation-specific evidence** (any one, documented): (a) the generated **entity id** taken from a record of this very request (the response, or a request-scoped record written by a layer outside S0-06, such as a transport request id stored with the generated id), and that id exists with the expected audit row; (b) an attribute that **only this request** supplied and that the operator can show is unique in practice (a serial number or external execution reference that appears nowhere else; these are non-unique by design, Q3 and Q4, so the uniqueness must be demonstrated and recorded); (c) other independent operator-held evidence that ties the candidate to the request. **Never evidence:** a unique audit row found by action, actor, window and details; the correlation id; the absence of a row.
- **While an outcome is UNKNOWN there is no automatic retry and no resubmission** by the service, the composition layer, a client library or a job. A create is never resent because a row is missing.
- **Operator reconciliation with documented evidence.** The operator records, in the incident record (a document outside the database; no new table): the command and its non-sensitive inputs; the actor; the attempt time window and the correlation id (as a search aid); the candidate audit ids; the evidence examined and its class; whether any transaction could still have been in flight; and the decision. The decisions are: **COMMITTED** (use the entity; do not resend); **UNKNOWN stands** (no resend; escalate); or an **operator-accepted resubmission**, which is an explicit, signed acceptance that the original may have committed and that a duplicate is a legitimate but unwanted entity (no uniqueness is approved, so a duplicate is not an integrity violation). The system never makes the third decision by itself.
- **No new idempotency subsystem.** A client-supplied operation identifier would remove the ambiguity, but it is deferred with the command idempotency middleware (Decision 7), is listed as an open Owner question, and nothing here requires it.

### 6.5 Verification tests for cutover and unknown outcomes (WP-05, real PostgreSQL)

1. **Fence evidence (catalogue):** on a disposable database prepared as the runbook prescribes, the privilege query lists only the writer role and the documented bypass roles; a legacy role left with one `INSERT` grant makes the check **fail** and activation is refused.
2. **Old-writer reconnect after the first verification:** after steps 2 to 4 of 6.2 have passed with a clean snapshot, a legacy-credential connection attempted **afterwards** fails at login or with `42501` on `INSERT` into each of the four domain tables and on the case-version `UPDATE`. This is run as separate cases for a **process restart**, a **reconnect**, an **overlapping deployment**, a **scheduled job** and a **worker**, and no row appears (inspected through a separate connection). The same check is repeated at step 6(b).
3. **`application_name` is not a boundary:** a connection that sets the audited build's `application_name` but uses a legacy credential is still refused.
4. **Writes stay held when the fence cannot be shown:** with a legacy role that still holds a write privilege, or a legacy writer connecting as the table owner, the verification returns a failure and the procedure's next state is "hold writes"; no writer is started.
5. **Detection scope of the completeness query:** a simulated legacy write by a privileged connection whose caller-chosen timestamp is **before** the activation instant is returned by the id-and-subject query and would be missed by a timestamp comparison; a row deleted by a privileged connection leaves nothing to detect, which documents that the query supports but does not replace the fence.
6. **Mandatory audit:** a service cannot be constructed without the audit writer; the startup readiness check refuses a database without the audit shape.
7. **Fail closed:** with the audit table renamed in a disposable database, every mutation throws and writes nothing; reads still work.
8. **Lost acknowledgment:** a test `TransactionScope` wrapper commits and then throws "acknowledgment lost": the command throws (not an `err` value), the domain and audit rows exist, a `linkAttempt` replay returns `concurrency_conflict`, and a create replay produces a second entity and second audit row, documenting why creates are not retried blindly.
9. **A unique candidate belonging to another operation stays UNKNOWN:** operation A (a `registerTestAttempt`) is rolled back with its outcome unknown to the caller; an identical operation B (same actor, same `uutId` and `stage`, the same reused `correlationId`) then commits. The candidate search for A returns **exactly one** record, B's. The classification of A is **UNKNOWN**, not COMMITTED. The same case is run for `registerUut` (no details) and for `openCase`.
10. **An absent record does not prove non-commit:** (a) a create commits with its acknowledgment lost and the search uses a wrong or changed correlation id or a too-narrow window: no candidate is found and the classification stays UNKNOWN; (b) a transaction is held open and uncommitted while the search runs and commits afterwards: the earlier empty result was misleading and the classification at that time was UNKNOWN; (c) the classification rule has no outcome that reports "not committed" from an empty search.
11. **Affirmative evidence settles COMMITTED, and only it:** with the entity id taken from a request-scoped record and a matching audit row (same subject id, action and actor), the classification is COMMITTED and nothing is resent; with an id from a record of a **different** request, or no id, it is UNKNOWN.
12. **No automatic retry or resubmission while UNKNOWN:** after the thrown acknowledgment-lost error the service and composition issue **no** second command: the number of entities and audit rows afterwards is one for the committed case and zero for the rolled-back case, and no create path contains a retry.
13. **Read-only reconciliation tooling:** the candidate query and the classification rule perform no writes (asserted by running them on a read-only connection).

## 7. FU-3 — `expectedVersion` validation and version exhaustion (Option B)

### 7.1 Two stages

- **Stage 1 (WP-01): the existing service plus FU-3.** The service keeps its current signatures, including the reads. It has no actor, no audit and no transaction change. Only steps 5 and 8 of 7.2 are added. The change to the public contract is **additive**: two new members of the error union.
- **Stage 2 (WP-03 and WP-05): the authenticated integration.** The `context` argument, authentication, correlation validation and authorization (A1 to A3), the `Result`-based reads (3.3) and the audit write (step 10) are added. This is a **breaking** change of the service and factory signatures. Stage 1 must be complete, reviewed and verified first, so that the two contract changes never mix.
- **Public contract comments (WP-01).** Stage 1 also updates the comments that document the contract, so they no longer state the pre-FU-3 order: the JSDoc of `InvestigationService.linkAttempt` and the documentation of `InvestigationServiceError` in `modules/investigation/src/application/investigation-service.ts` must list the runtime `expectedVersion` validation (step 5), the exhaustion rule (step 8) and both new codes, and keep the statement that the Expected Version takes precedence over idempotency. The S0-05 specification and closure records are closed and are not edited by WP-01 unless the Owner asks. The comment change is comments only: no behaviour, no signature.
- Neither stage is approved by this document; both need the Owner's confirmation (D8).

### 7.2 Precedence

The canonical order of 2.7 applies in Stage 2 (A1 to A3 and D before the transaction). **Inside the transaction** (Stage 1 and Stage 2) the FU-3 order is:

| Step | Check                                                        | Stage        | Error                                                              |
| ---- | ------------------------------------------------------------ | ------------ | ------------------------------------------------------------------ |
| 1    | Role validation (pure; before the transaction in Stage 2)    | 1 (existing) | `investigation.invalid_link_role`                                  |
| 2    | Case lookup                                                  | 1 (existing) | `investigation.case_not_found`                                     |
| 3    | Attempt lookup                                               | 1 (existing) | `investigation.attempt_not_found`                                  |
| 4    | Same-UUT validation                                          | 1 (existing) | `investigation.uut_mismatch`                                       |
| 5    | **Runtime `expectedVersion` validation**                     | 1 (new)      | `investigation.invalid_expected_version`                           |
| 6    | Version comparison                                           | 1 (existing) | `investigation.concurrency_conflict` (service shape)               |
| 7    | Duplicate detection (identical link at the matching version) | 1 (existing) | none: `ok`, `created: false`                                       |
| 8    | **Version exhaustion** (a new link needing `version + 1`)    | 1 (new)      | `investigation.version_exhausted`                                  |
| 9    | Save (atomic insert and bump)                                | 1 (existing) | repository errors, incl. `concurrency_conflict` (repository shape) |
| 10   | Audit write, same transaction                                | 2            | thrown on failure; rollback                                        |

Full order: Authentication → Correlation Validation → Authorization → Role (Domain Validation) → Transaction → Case → Attempt → Same-UUT → Runtime Version Validation → Version Comparison → Duplicate Detection → Version Exhaustion → Save → Audit.

### 7.3 Runtime validation (step 5)

Valid only if `typeof value === 'number'`, `Number.isSafeInteger(value)`, `value >= 1` and `value <= 2147483647`. No coercion. Rejected, each with its own test: strings (`'3'`, `''`); `3n`; booleans (`true`, `false`); `new Number(3)` and other boxed values; `NaN`; `±Infinity`; fractions (`2.5`); `0` and `-0`; negatives (`-1`); `2147483648` (`MAX + 1`); unsafe integers (`9007199254740993`); `undefined`; `null`; **an omitted property** (a JavaScript caller that sends no `expectedVersion` at all, which is `undefined` at runtime and is treated as `not_a_number` with `actualType: 'undefined'`); a `Symbol`; functions; arrays; objects.

### 7.4 Contracts

#### 7.4.1 Existing `investigation.concurrency_conflict`: two shapes, both preserved

`RepositoryError` declares `details?: { expectedVersion?: number; actualVersion?: number }`, and the two producers fill it differently. Neither changes.

| Producer                                                                                          | Where                                          | `details`                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Service version mismatch** (step 6): the loaded case is not at the version the caller sent      | `investigation-service.ts`                     | `{ expectedVersion: number; actualVersion: number }`, the caller's value and the stored one |
| **Repository compare-and-save race** (step 9): the atomic `UPDATE … WHERE version` matched no row | `drizzle-investigation-repository.ts` (`save`) | `{ expectedVersion: number }` **only**; there is no `actualVersion`                         |

A consumer must not assume `actualVersion` is present. In the repository shape, `expectedVersion` is the version of the case instance that was passed to `save`.

#### 7.4.2 Proposed `investigation.invalid_expected_version`

Step 5; returned as a value, never thrown.

```ts
type InvalidExpectedVersionError = SdrisError<
  'investigation.invalid_expected_version',
  {
    readonly reason: 'not_a_number' | 'not_a_safe_integer' | 'out_of_range';
    readonly minimum: 1;
    readonly maximum: 2147483647;
    readonly actualType:
      | 'number'
      | 'string'
      | 'bigint'
      | 'boolean'
      | 'object'
      | 'undefined'
      | 'symbol'
      | 'function'
      | 'null';
  }
>;
```

`reason`, evaluated in order: `typeof !== 'number'` gives `not_a_number`; otherwise not a finite safe integer (`NaN`, infinities, fractions, unsafe integers) gives `not_a_safe_integer`; otherwise `< 1` or `> 2147483647` gives `out_of_range`. `actualType` is `typeof` with `null` reported as `'null'`. **The raw input is never echoed, including finite numbers** (Owner direction C12): `details` contains exactly the keys `reason`, `minimum`, `maximum` and `actualType`, and nothing derived from the value other than the `typeof` tag. `message` is fixed text and not part of the contract.

#### 7.4.3 Proposed `investigation.version_exhausted`

Step 8; returned as a value, never thrown; a separate contract with no overlap with 7.4.2.

```ts
type VersionExhaustedError = SdrisError<
  'investigation.version_exhausted',
  { readonly actualVersion: 2147483647; readonly maximumVersion: 2147483647 }
>;
```

### 7.5 Exact tests

Stage 1 tests run against the existing signatures; races run on real PostgreSQL with the existing row-lock and `pg_stat_activity` technique. FU-2 (scheduling) is an input, not a dependency.

1. **Precedence (unit, then PostgreSQL):** an invalid `expectedVersion` with each of an unknown role, unknown case, unknown attempt and cross-UUT pair returns the earlier error (`invalid_link_role`, `case_not_found`, `attempt_not_found`, `uut_mismatch`); an invalid value on a valid request returns `invalid_expected_version`; the same holds for a JavaScript call that **omits** `expectedVersion`; a valid stale value returns `concurrency_conflict` even when the identical link exists.
2. **Malformed values:** every value of 7.3 returns the exact `reason` and `actualType` of 7.4.2; the error `details` have **exactly** the keys `reason`, `minimum`, `maximum` and `actualType` (a test fails if any other key, such as a copy of the value, appears; this covers finite numbers such as `2.5`, `0`, `-1` and `2147483648`); every value class of 7.3 is exercised, including booleans, boxed numbers and the omitted property; nothing is written and no repository write call is made.
3. **Maximum version:** with a case at 2147483647 (test-only SQL): a new link returns `version_exhausted` (details exactly as 7.4.3); the matching duplicate (same role) returns `ok`, `created: false`, version unchanged, no write; **a link of the same attempt with a different role** is a new link and returns `version_exhausted` (the role does not change the rule); a stale value returns `concurrency_conflict` (service shape, with `actualVersion`); an `expectedVersion` of 2147483648 returns `invalid_expected_version`; the column definition is unchanged and PostgreSQL error 22003 is never raised.
4. **Duplicate no-op:** at a normal version, a matching duplicate returns `created: false`, writes no row and does not change the version.
5. **Race, repository shape:** two concurrent new links with the same `expectedVersion`, with the loser forced past step 6 by the row-lock technique: exactly one `ok` and one link row; the loser's `concurrency_conflict` has `details` with `expectedVersion` and **without** `actualVersion`.
6. **Sequential stale, service shape:** the loser arriving after the winner committed gets `concurrency_conflict` **with** `actualVersion`.
7. **Race at the boundary:** two concurrent new links at `expectedVersion = 2147483646`: one reaches 2147483647 and the other conflicts; a following new link at `expectedVersion = 2147483647` returns `version_exhausted`.
   7a. **Sequential boundary:** from a case at `2147483646`, one new link with `expectedVersion = 2147483646` returns `ok`, `created: true`, version `2147483647`; an immediately following **different-role** link with `expectedVersion = 2147483647` returns `version_exhausted`; a repeat of the first request returns `concurrency_conflict` (service shape), because the version moved.
8. **Compatibility:** the type-surface test passes with the widened union; the compiled-runtime test still passes.

### 7.6 Public API compatibility inventory (by search at `ae7dc51`)

| Surface                                                           | Where it is used today                                                                                                                                                                                                                 | Stage 1 (additive)                                                                                          | Stage 2 (breaking)                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `InvestigationServiceError` (exported from the public entrypoint) | `investigation-service.ts`, re-exported by `public/index.ts`; used in `investigation-service.spec.ts` and the two api integration tests                                                                                                | Union gains two members                                                                                     | Union gains `AccessError`                                                     |
| Direct service callers (writes)                                   | `investigation-service.spec.ts`, `apps/api/src/composition/investigation.integration.test.ts`, `investigation-links.integration.test.ts`, `tests/runtime/compiled-runtime.child.cjs`                                                   | No signature change; a non-conforming `expectedVersion` now gets a value (none in the repository sends one) | `context` first argument                                                      |
| Direct service callers (reads)                                    | The same four files (inventory in 3.3)                                                                                                                                                                                                 | Unchanged                                                                                                   | `context` first argument and `Result` return                                  |
| Factory and composition callers                                   | `modules/investigation/src/composition/index.ts` (`createInvestigationModule`), `apps/api/src/composition/investigation.composition.ts` (`composeInvestigation`), architecture fixtures and `tests/architecture/type-surface.test.mjs` | None                                                                                                        | Required `actorResolver`, audit and security log wiring; changed options type |
| Exhaustive error handlers                                         | **None found** in `modules` or `apps` (search for a `switch` on `code` or `error`)                                                                                                                                                     | Nothing breaks in the repository; an external one would                                                     | Same                                                                          |
| Compiled-runtime consumers                                        | `tests/runtime/compiled-runtime.child.cjs` and `compiled-runtime.test.mjs` (plain Node on `dist`)                                                                                                                                      | Unaffected unless extended                                                                                  | The child supplies an ephemeral principal and handle                          |

### 7.7 Version exhaustion and storage

The `integer` column and `check (version >= 1)` are unchanged (C9). Step 8 runs only when `current.version === expectedVersion` (step 6) and fails when that version is 2147483647, so `save` never evaluates `version + 1` past the maximum. At the maximum: a matching duplicate stays `ok` with `created: false` and writes no audit record; a stale value yields `concurrency_conflict`; only a new link fails.

## 8. Acceptance criteria (proposed, testable)

All persistence criteria run against real PostgreSQL (ADR-025 Decision 10). **The criteria themselves (this table) are approved by the Owner under D9 before implementation starts.** Evidence is **produced during implementation** in the package named in the last column and **consolidated in WP-06**; no criterion is satisfied by this document. The reviewed SHA `ae7dc51` is not automatically the integration SHA (front matter).

| ID    | Area                             | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence produced in                                                                                    |
| ----- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| AC-1  | Trusted Actor and startup        | **Valid outcome:** a resolver outcome of `valid` lets the command proceed to the next check of 2.7: no rejection and no security event. **Rejected outcomes:** each of `missing`, `invalid`, `expired` and `revoked` yields `unauthenticated` with no transaction opened and exactly one emission attempt of one Security Log event with the matching reason (exactly one observed event with a functioning sink). Also: expiry at `now >= expiresAt`; revocation; foreign-issuer and forged handles rejected; claims unaltered by anything the caller holds. **Issuer refusals** (2.10) are separate: each refusal makes exactly one emission attempt of `security.issuance_refused` (one observed event with a functioning sink), a successful issuance makes none, and no key or credential text is in the event. The paired startup tests of 3.2 pass at the **composition entrypoint** (`composeInvestigation`), unit and compiled; a **process exit is claimed only if `main.ts` is wired**                                                                                                                                                     | WP-02, WP-06 (compiled)                                                                                 |
| AC-2  | Authorization and order          | The canonical order of 2.7 holds for each command and read: authentication, then correlation, then authorization, then pure domain validation, then the transaction; a direct service call is checked identically; no transaction on any rejection; Security Log content per 4.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | WP-03                                                                                                   |
| AC-3  | Audit coverage                   | Each of the four commands writes exactly one `audit_record` with the action, subject, `case_id`, actor, kind, `source`, `correlation_id` and `details` of 4.3, 4.4 and 4.6, and the persisted-timestamp equality of the last column of 4.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | WP-05                                                                                                   |
| AC-4  | Transaction atomicity            | The five rollback verifications of 4.2 pass, each asserted through a separate connection on both the domain tables and `audit_record`; audit row counts equal committed state changes; a missing token throws `AuditTransactionRequiredError`; an unknown or ended token throws `TransactionContextError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WP-04 (adapter), WP-05 (service)                                                                        |
| AC-5  | Idempotency                      | A matching duplicate link returns `created: false`, changes nothing (no new row, version unchanged), including at version 2147483647. **WP-01** proves this without any audit assertion (no audit exists at Stage 1); **WP-05** adds that it writes no audit row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | WP-01 (state), WP-05 (state and audit)                                                                  |
| AC-6a | Concurrency (Stage 1)            | The races of 7.5 items 5 to 7 on real PostgreSQL, **without audit**: one `ok` and one `concurrency_conflict` of the **repository** shape for a compare-and-save race, one link row, version advanced once; the boundary race at `MAX - 1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WP-01                                                                                                   |
| AC-6b | Concurrency plus audit (Stage 2) | The same races with the audit writer active: exactly one `attempt_linked` audit row (the winner's), none for the loser, written in the winner's transaction and absent if that transaction rolls back; state inspected through a separate connection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | WP-05                                                                                                   |
| AC-7  | Invalid `expectedVersion`        | Every value of 7.3 returns `invalid_expected_version` with the deterministic `reason` and `actualType` of 7.4.2, after `case_not_found`, `attempt_not_found`, `uut_mismatch` and before `concurrency_conflict`; nothing is written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | WP-01                                                                                                   |
| AC-8  | Version exhaustion               | At version 2147483647 (test-only SQL): new link, `version_exhausted`; duplicate, `created: false`; stale, `concurrency_conflict`; the column definition is unchanged; PostgreSQL error 22003 never occurs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WP-01                                                                                                   |
| AC-9  | Architecture compliance          | `pnpm check:architecture` passes; the diff of `scripts/architecture/dependency-matrix.json` is **empty** for `contextInfrastructure`, `compositionRoots` and `testOnlyEntrypoints`; the identity import rules have valid and invalid fixtures (WP-02); audit **application, domain and adapter code** exists only under `modules/investigation`, with Drizzle only in `src/infrastructure`; no shared audit package; no new dependency. **The only audit-related artifacts allowed outside the module are:** migration `0003` under `infrastructure/database/migrations` (WP-04); the table-inventory updates of the existing migration and runtime tests (AC-10, AC-11); the **compiled-runtime audit round trip** in `tests/runtime/compiled-runtime.child.cjs` and its test, which drive the compiled service through an audited command against real PostgreSQL (WP-06); the **approved connection instrumentation**, that is `application_name` in the database package, which exists only if the Owner approves it under D6, is observability only, and carries no Investigation knowledge; and the cutover runbook in `docs/runbooks/` (WP-05) | WP-02 (identity rules), WP-04 (audit boundary, migration), WP-05 (runbook), WP-06 (compiled round trip) |
| AC-10 | Migration and PostgreSQL         | `infrastructure/database/migrations/0003_create_investigation_audit_record.sql` applies on a clean database and on one at `0002`; `0001` and `0002` checksums are unchanged; the migration inventory tests (`migrations.integration.test.ts`, `migrations.spec.ts`) and the table list of `tests/runtime/compiled-runtime.child.cjs` are updated **in WP-04**, and the differential and invariant migration tests are re-run in WP-04; update, delete and truncate of audit rows are rejected; the check constraints reject out-of-allowlist `details`, `source` and `case_id` violations; the adapter lives in `modules/investigation/src/infrastructure/persistence`, the port in `application/ports`                                                                                                                                                                                                                                                                                                                                                                                                                                               | WP-04                                                                                                   |
| AC-11 | S0-05 regression                 | The S0-05 unit, integration, concurrency and compiled-runtime tests pass at **every** package; changes to existing tests are limited to: the FU-3 cases (WP-01; no signature change); the table and migration inventory expectations that `0003` requires in `migrations.integration.test.ts`, `migrations.spec.ts` and `tests/runtime/compiled-runtime.child.cjs` (WP-04); and the `context` argument and its caller updates (WP-03). Any other change to an existing test is reported to the Owner. Stage 1 leaves the existing signatures unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | each WP; consolidated in WP-06                                                                          |
| AC-12 | Activation and recovery          | The tests of 6.5 pass: fence evidence by catalogue query; **an old-writer reconnect after the first clean verification fails** for a restart, a reconnect, an overlapping deployment, a scheduled job and a worker; `application_name` is not a boundary; writes stay held when the fence cannot be shown; the completeness query detects by id and subject, not timestamp, and is not treated as proof; mandatory audit; fail closed; lost acknowledgment; the unknown-create tests (another operation's unique candidate stays UNKNOWN, an absent record is not proof, only operation-specific evidence gives COMMITTED, no automatic retry, read-only tooling). Recovery is never an unaudited write path                                                                                                                                                                                                                                                                                                                                                                                                                                          | WP-05                                                                                                   |
| AC-13 | Read policy (Stage 2)            | **Required in either branch; never skipped.** **AC-13a, if the Owner approves authenticated reads (3.3):** reads return `Result` with `AccessError`; absence is `ok(undefined)`; a rejection writes no row and makes exactly one emission attempt of one Security Log event; reads write no audit record. **AC-13b, if the Owner defers read authentication:** the exposure boundary of 3.3 holds: the facade is an explicitly constructed object with exactly the three read methods and no write methods, no HTTP controller or provider injects the service or the facade, and both deferred-read tests pass. WP-06 consolidates the evidence of whichever branch the Owner approves                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WP-03 (evidence), WP-06 (consolidation)                                                                 |

Placement note: AC-10 names the repository's actual layout (migration in `infrastructure/database/migrations`, adapter in `modules/investigation/src/infrastructure/persistence`, port in `application/ports`).

## 9. Constraints that remain in force

ADR-025 and A1 to A4 (no new persistence user outside the allowlist, no cross-module internal imports, `src/public` as the only cross-module surface), no `drizzle-kit`, no new dependency, synthetic data only, injected clock, UUIDv7 identifiers, no automatic progression to S0-07. **ADR-025 Decision 5:** its historical text stays CONDITIONAL in ADR-025 for good; the condition is satisfied by the A2 section of the [effective-policy file](../adr/ADR-025-effective-policy.md) now that A2 is accepted. Decision 7 stays as written; the [proposed Amendment A5](../adr/ADR-025-postgresql-persistence-architecture.md) narrows it for Investigation only and is **PROPOSED**.

## 10. Open questions for the Owner

Consolidated in the [decision register](S0-06-owner-decision-register.md) section 6 and the remediation matrix.
