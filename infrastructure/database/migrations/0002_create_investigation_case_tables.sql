-- S0-05: tables owned by the Investigation context (schema `investigation`). Minimal aggregate storage only.
-- No status columns and no lifecycle: those need the approved S0-05 specification.
-- `uut_id` is an SDRIS internal identifier (UUIDv7) referencing a unit under test. It is a reference, not a
-- foreign key: the UUT's authoritative owner is outside this migration.

create table investigation.investigation_case (
  id          uuid        primary key,
  uut_id      uuid        not null,
  opened_at   timestamptz not null,
  -- optimistic concurrency: every successful save increments it
  version     integer     not null default 1 check (version >= 1),
  -- lets child rows prove they belong to this case AND this UUT (see failure_observation)
  constraint investigation_case_id_uut_key unique (id, uut_id)
);

create table investigation.failure_observation (
  id          uuid        primary key,
  case_id     uuid        not null,
  uut_id      uuid        not null,
  description text        not null check (length(btrim(description)) > 0 and length(description) <= 2000),
  observed_at timestamptz not null,
  -- Cross-UUT rejection enforced by the database as well as by the domain: an observation can only be
  -- stored against a case whose UUT is the observation's UUT.
  constraint failure_observation_case_uut_fkey
    foreign key (case_id, uut_id) references investigation.investigation_case (id, uut_id)
);

create index failure_observation_case_idx on investigation.failure_observation (case_id, observed_at, id);

comment on table investigation.investigation_case is 'Owner: Investigation context. Aggregate root.';
comment on table investigation.failure_observation is 'Owner: Investigation context. Append-only child of investigation_case.';
