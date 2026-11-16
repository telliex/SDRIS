# Module Boundaries and Architecture Checks

Status: **PROPOSED**. The approved Architecture Baseline and its dependency matrix are not committed to
this repository yet (`docs/architecture/` was empty before this document). This page documents what
`pnpm check:architecture` enforces today. It does not define new architecture.

Canonical references (not duplicated here):

- Bounded contexts, ownership and the "one entity, one owner" rule: [AGENTS.md section 4](../../AGENTS.md)
- Shared Kernel rules: [AGENTS.md section 5](../../AGENTS.md)
- Cross-module import boundary (`src/public`): [CLAUDE.md section 5](../../CLAUDE.md)
- Sprint 0 scope: [ADR-024](../adr/ADR-024-sprint-0-execution.md)

## Ownership

| Layer            | Packages                              | Notes                                                                            |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `app`            | `apps/web`, `apps/api`, `apps/worker` | Composition and delivery only                                                    |
| `module`         | `modules/*` (nine bounded contexts)   | Own their internals                                                              |
| `kernel`         | `packages/shared-kernel`              | Minimal technical primitives                                                     |
| `contracts`      | `packages/contracts`                  | Public API and event contracts                                                   |
| `config`         | `packages/config`                     | Configuration support                                                            |
| `testing`        | `packages/testing`                    | Test utilities                                                                   |
| `infrastructure` | `infrastructure/*`                    | **Global Infrastructure**: shared technology plumbing (S0-04: `@sdris/database`) |

A new directory under `packages/` is reported as `workspace/unclassified-package` until its layer is
decided. The checker does not guess permissions.

## Allowed dependency direction

```text
apps/*  ──►  modules (public entrypoint only)  ──►  shared-kernel, contracts
   └──────────────────────────────────────────────►  shared-kernel, contracts, config
```

| From             | May import                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `app`            | module public entrypoints, kernel, contracts, config, infrastructure; `testing` from test files                 |
| `module`         | kernel, contracts; `testing` from test files; **other modules only if in the matrix**                           |
| `kernel`         | nothing in the workspace, and no framework or ORM packages                                                      |
| `contracts`      | kernel                                                                                                          |
| `config`         | kernel                                                                                                          |
| `testing`        | kernel, contracts                                                                                               |
| `infrastructure` | kernel, contracts, config. **Not business modules, with no default exception** (proposed, ADR-025 Amendment A1) |

Nothing may import an `app`. Test files are `*.spec.*`, `*.test.*` and anything under `__tests__`.

### Module-to-module dependencies: default deny

No approved matrix exists, so **no module may depend on another module**. Allowed edges are listed
explicitly in [`scripts/architecture/dependency-matrix.json`](../../scripts/architecture/dependency-matrix.json)
(currently empty). Do not add an edge to make a check pass; see "Exceptions" below.

## Public entrypoint conventions

- A module publishes only files under `src/public/`. The package `main`/`types` (or `exports`) must point
  there (`package/entrypoint-location`).
- Consumers import the package name: `@sdris/evidence`. A subpath such as `@sdris/evidence/contracts`
  is allowed only if the package lists it in `exports`. Wildcard `exports` patterns are not analysable
  and are rejected.
- Cross-package imports must use the package name, even when a relative path would land on the public
  file (`boundary/package-specifier-required`).
- A TypeScript `paths` alias is accepted only if it resolves to a published entrypoint.

Classification always uses the **resolved owning package and target file**. The word `public` in a path
means nothing on its own.

## Examples

```ts
// apps/api/src/composition.ts
import type { Marker } from '@sdris/investigation'; // allowed: published entrypoint
import type { EntityId } from '@sdris/shared-kernel'; // allowed: app -> kernel

import { CaseRepository } from '@sdris/investigation/src/infrastructure/case-repository'; // boundary/private-import
import { model } from '../../../modules/evidence/src/domain/model'; // boundary/private-import
import type { Marker } from '../../../modules/evidence/src/public'; // boundary/package-specifier-required
```

More cases live in `tests/architecture/fixtures/{valid,invalid}/`; each directory holds the files and an
`expect.json` naming the exact rule and file that must be reported.

## Rules

| Rule                                                                                                                   | Enforces                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boundary/private-import`                                                                                              | Importing another package's non-published code (relative, alias, package subpath)                                                                                                                                          |
| `boundary/package-specifier-required`                                                                                  | Relative import into another package's public file                                                                                                                                                                         |
| `boundary/unknown-workspace-package`                                                                                   | `@sdris/*` name that is not a workspace package                                                                                                                                                                            |
| `boundary/outside-workspace`                                                                                           | Import resolving outside every workspace package                                                                                                                                                                           |
| `dependency/direction`                                                                                                 | Layer policy and the module matrix above                                                                                                                                                                                   |
| `dependency/forbidden-external`                                                                                        | Kernel importing NestJS, Next.js, React or an ORM; contracts, config or testing importing an ORM, query builder or driver; a module importing one outside `src/infrastructure/**` or without an allowlist entry            |
| `boundary/infrastructure-inversion`                                                                                    | Any file of a module other than `src/infrastructure/**` and `src/composition/**` importing that module's `src/infrastructure/**` (relative, alias, barrel, re-export)                                                      |
| `boundary/composition-inversion`                                                                                       | Any file of a module other than `src/composition/**` importing that module's `src/composition/**`                                                                                                                          |
| `dependency/composition-access`                                                                                        | A file that is not an approved composition root (package and path listed in `compositionRoots`) importing `@sdris/<context>/composition`                                                                                   |
| `composition/adapter-exposure`                                                                                         | `src/composition/**` re-exporting Context Infrastructure, an ORM or a Global Infrastructure package, including `export { X }` of an imported binding                                                                       |
| `composition/explicit-return-type`                                                                                     | An exported composition function without an explicit return type                                                                                                                                                           |
| `composition/type-surface-leak`, `public/type-surface-leak`, `composition/declaration-leak`, `public/declaration-leak` | A public or composition signature (or its generated `.d.ts`) exposing an adapter, an ORM or driver type, a non-approved database symbol, or a non-opaque handle                                                            |
| `package/entrypoint-location`                                                                                          | `.` outside `src/public/**`; `./composition` anywhere but `src/composition/index.ts`; any other subpath outside `src/public/**`                                                                                            |
| `package/exports-condition`                                                                                            | A `{ sdris-source, types, default }` entrypoint whose `types` or `default` is not the exact dist mirror of the source target, or that has another condition, a missing condition, or a source outside `./src` (ADR-025 A4) |
| `dependency/test-only-entrypoint`                                                                                      | A non-test file importing a `testOnlyEntrypoints` entry or the directory behind it, by name, subpath, alias, re-export, dynamic import, require, type-only import, relative path or self-reference (ADR-025 A3)            |
| `dependency/manifest`                                                                                                  | Kernel `package.json` declaring workspace or framework/ORM dependencies; module, contracts, config or testing manifests declaring an ORM, query builder or driver                                                          |
| `package/entrypoint-location`                                                                                          | Module entrypoint outside `src/public/`                                                                                                                                                                                    |
| `package/unsupported-exports-pattern`                                                                                  | `exports` wildcard the checker cannot analyse                                                                                                                                                                              |
| `cycle/cross-package`                                                                                                  | Dependency cycle across packages (labelled `(type-only)` when every edge is)                                                                                                                                               |
| `workspace/unclassified-package`                                                                                       | `packages/*` entry with no declared layer                                                                                                                                                                                  |

Imports covered: `import`, `import type`, `export ... from`, `import x = require()`, `require()`, dynamic
`import()` with a literal, and `import('x').T` types. Relative paths, tsconfig `paths` and `baseUrl` (including
`extends`) and workspace names are all resolved. Non-relative specifiers follow TypeScript's order: `paths`,
then `baseUrl`, then workspace/external packages. An alias only counts if its target file exists; otherwise
resolution falls through, as it does in `tsc`.
Each import is resolved to the single file TypeScript would pick (a file beats a directory of the same
name, then a directory's `package.json` `types`/`main`, then `index`), and only that file is compared with
the package's published entrypoints. A sibling `public.ts` therefore does not inherit the status of
`public/index.ts`.

## Running

```sh
pnpm check:architecture            # exit 0 = compliant, 1 = violations, 2 = could not analyse
pnpm check:architecture -- --json  # machine-readable
pnpm test                          # includes tests/architecture (positive and negative fixtures)
```

## Diagnosing a violation

```text
ERROR boundary/private-import  modules/investigation/src/application/open-case.ts:1
      Relative import "../../../evidence/src/domain/model" reaches @sdris/evidence internals (...)
      hint: Import from the published entrypoint "@sdris/evidence" instead.
```

1. Read the rule id and the `file:line`; the message names the owning package and resolved target.
2. Fix the import to use the owner's published entrypoint, or move the shared concept behind a published
   contract owned by the right context. Do not move domain logic into `shared-kernel` or `contracts` to
   avoid the rule.
3. A cycle report lists every edge in the cycle; break it with a published contract or an event.

## Exceptions

Do not weaken a rule or add a matrix edge in a feature PR. Propose an ADR describing the dependency, why a
published contract cannot serve, and the owning context; the matrix change lands with the approved ADR.

## Known limitations

- Non-literal `import(expr)` / `require(expr)` cannot be analysed. They are printed as `NOTE`, not failures.
- Cycles **inside** one package are allowed. Only cycles across packages fail.
- Type-only imports are checked like value imports for boundaries and cycles (they still couple designs);
  a cycle made only of type-only edges is labelled.
- `package.json` `imports` (`#subpath` specifiers), `rootDirs` and `moduleSuffixes` are not resolved; such
  specifiers are treated as external.
- `exports` wildcard patterns and conditional resolution beyond picking declared targets are unsupported.
- Declared-dependency hygiene (importing `@sdris/x` without listing it in `package.json`) is not checked.
- `infrastructure/*` packages are scanned as the `infrastructure` layer (Global Infrastructure). `modules/<context>/src/infrastructure/**` is **Context Infrastructure**: the only place in a module where an allowlisted persistence package may be used (proposed in ADR-025 Amendment A1). `modules/<context>/src/composition/**` is the **composition zone** (Amendment A2): it may import the same context's infrastructure, and the database contract only as a type; nothing else in the module may import it. Only `src/infrastructure/**` and `src/composition/**` may import their module's Context Infrastructure (A2 revises A1 Rule 3).
- Database-level ownership ("never write another module's tables") is out of scope for import checks.

## Decision evidence and pending Owner decisions

Everything in this document is **PROPOSED**. Nothing here is approved by the Engineering Owner. This
table records what evidence exists in the repository, and what is missing.

| Item                                                                                                                                                                     | Evidence found in the repository                                                                                                                                                                                                                                                                 | Status                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Formal S0-03 acceptance criteria                                                                                                                                         | Task name only: [CLAUDE.md](../../CLAUDE.md) task table ("S0-03 Architecture Boundary Rules"). The criteria came from the task prompt, which is not committed.                                                                                                                                   | **Pending Owner Decision** |
| Architecture Baseline                                                                                                                                                    | None. `docs/architecture/` was empty before this document. [AGENTS.md](../../AGENTS.md) says ADR-001 to ADR-024 exist in planning history and must not be assumed committed.                                                                                                                     | **Pending Owner Decision** |
| ADRs                                                                                                                                                                     | Only [ADR-024](../adr/ADR-024-sprint-0-execution.md), which scopes Sprint 0 but sets no dependency rules.                                                                                                                                                                                        | **Pending Owner Decision** |
| Module-to-module dependency matrix                                                                                                                                       | None. `scripts/architecture/dependency-matrix.json` is empty and marked PROPOSED; default is deny.                                                                                                                                                                                               | **Pending Owner Decision** |
| Composition zone, `@sdris/<context>/composition` entrypoint, `compositionRoots` allowlist and public type-surface verification (ADR-025 Amendment A2, revises A1 Rule 3) | `scripts/architecture/dependency-matrix.json` keys `contextInfrastructure` and `compositionRoots` (committed with Investigation and `apps/api/src/composition/**` only); fixtures `20`-`24` valid, `40`-`50b` invalid; `type-surface.mjs` tests. Implemented for review; not an approved policy. | **Pending Owner Decision** |
| Context Infrastructure allowlist, zone restrictions and inversion rule (ADR-025 Amendment A1)                                                                            | `scripts/architecture/dependency-matrix.json` key `contextInfrastructure` (empty by default); fixtures `27*` to `32*`, valid `18`, `19`; policy validation tests. Implemented for review; not an approved policy.                                                                                | **Pending Owner Decision** |
| `infrastructure` layer and persistence-library ban (S0-04)                                                                                                               | Added to the checker with fixtures `23*` to `26*`, valid `16`, `17`. Implementer's proposal derived from the S0-04 task and AGENTS.md section 3; not an approved policy.                                                                                                                         | **Pending Owner Decision** |
| Shared-package layer policy                                                                                                                                              | Not defined. The policy table above is the implementer's proposal based on [AGENTS.md section 5](../../AGENTS.md).                                                                                                                                                                               | **Pending Owner Decision** |
| Cross-package relative imports                                                                                                                                           | Not defined. Rejected by this checker as a conservative choice.                                                                                                                                                                                                                                  | **Pending Owner Decision** |
| CI deferred to S0-10                                                                                                                                                     | [CLAUDE.md](../../CLAUDE.md) task table lists "S0-10 CI Gates"; no `.github/workflows` exist. The deferral rule itself comes from the uncommitted task prompt.                                                                                                                                   | **Pending Owner Decision** |

Do not change a status to APPROVED without an Owner-approved ADR or an explicit recorded approval.

## CI

No GitHub Actions workflow exists; CI is reserved for S0-10. `pnpm check:architecture` is ready to be a
required job there (it needs only Node and `pnpm install`). Until then it must be run locally, and PRs
should record its result.
