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

| Layer       | Packages                              | Notes                          |
| ----------- | ------------------------------------- | ------------------------------ |
| `app`       | `apps/web`, `apps/api`, `apps/worker` | Composition and delivery only  |
| `module`    | `modules/*` (nine bounded contexts)   | Own their internals            |
| `kernel`    | `packages/shared-kernel`              | Minimal technical primitives   |
| `contracts` | `packages/contracts`                  | Public API and event contracts |
| `config`    | `packages/config`                     | Configuration support          |
| `testing`   | `packages/testing`                    | Test utilities                 |

A new directory under `packages/` is reported as `workspace/unclassified-package` until its layer is
decided. The checker does not guess permissions.

## Allowed dependency direction

```text
apps/*  ──►  modules (public entrypoint only)  ──►  shared-kernel, contracts
   └──────────────────────────────────────────────►  shared-kernel, contracts, config
```

| From        | May import                                                                            |
| ----------- | ------------------------------------------------------------------------------------- |
| `app`       | module public entrypoints, kernel, contracts, config; `testing` from test files       |
| `module`    | kernel, contracts; `testing` from test files; **other modules only if in the matrix** |
| `kernel`    | nothing in the workspace, and no framework or ORM packages                            |
| `contracts` | kernel                                                                                |
| `config`    | kernel                                                                                |
| `testing`   | kernel, contracts                                                                     |

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

| Rule                                  | Enforces                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `boundary/private-import`             | Importing another package's non-published code (relative, alias, package subpath) |
| `boundary/package-specifier-required` | Relative import into another package's public file                                |
| `boundary/unknown-workspace-package`  | `@sdris/*` name that is not a workspace package                                   |
| `boundary/outside-workspace`          | Import resolving outside every workspace package                                  |
| `dependency/direction`                | Layer policy and the module matrix above                                          |
| `dependency/forbidden-external`       | Kernel importing NestJS, Next.js, React or an ORM                                 |
| `dependency/manifest`                 | Kernel `package.json` declaring workspace or framework/ORM dependencies           |
| `package/entrypoint-location`         | Module entrypoint outside `src/public/`                                           |
| `package/unsupported-exports-pattern` | `exports` wildcard the checker cannot analyse                                     |
| `cycle/cross-package`                 | Dependency cycle across packages (labelled `(type-only)` when every edge is)      |
| `workspace/unclassified-package`      | `packages/*` entry with no declared layer                                         |

Imports covered: `import`, `import type`, `export ... from`, `import x = require()`, `require()`, dynamic
`import()` with a literal, and `import('x').T` types. Relative paths, tsconfig `paths` and `baseUrl` (including
`extends`) and workspace names are all resolved. Non-relative specifiers follow TypeScript's order: `paths`,
then `baseUrl`, then workspace/external packages. An alias only counts if its target file exists; otherwise
resolution falls through, as it does in `tsc`.

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
- `infrastructure/*` has no TypeScript yet and is not scanned.
- Database-level ownership ("never write another module's tables") is out of scope for import checks.

## CI

No GitHub Actions workflow exists; CI is reserved for S0-10. `pnpm check:architecture` is ready to be a
required job there (it needs only Node and `pnpm install`). Until then it must be run locally, and PRs
should record its result.
