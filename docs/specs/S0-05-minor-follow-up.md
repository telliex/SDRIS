# S0-05 — MINOR Findings Follow-up

**Decision:** The Engineering Owner agreed on 2026-11-17 in the project conversation to defer the four MINOR findings to the named follow-up tasks below, as conditions of S0-05 architecture acceptance. This record does not claim that the findings have been fixed or that S0-05 is closed. Claude Code may execute each task when requested; the Engineering Owner reviews and decides whether to accept the result. Scheduling remains open.

| Task | Finding | Intended outcome | Execution and review | Schedule | State |
| --- | --- | --- | --- | --- | --- |
| S0-05-FU-1 — Bound concurrency-test retries | MINOR-1 | Add an explicit limit and useful failure message to the test-side retry loop. | Claude Code; Engineering Owner reviews | Pending scheduling | Open |
| S0-05-FU-2 — Review concurrency-test scheduling | MINOR-2 | Assess the existing schedule-independent assertions and add controlled scheduling tests where needed to establish particular interleavings. | Claude Code; Engineering Owner reviews | Pending scheduling | Open |
| S0-05-FU-3 — Define expectedVersion input validation | MINOR-3 | Decide the runtime input-validation and error contract before implementing a change. | Claude Code; Engineering Owner reviews | Pending scheduling | Open |
| S0-05-FU-4 — Assess the extra persistence query | MINOR-4 | Assess the extra query and consider optimization when supported by measurements or related work. | Claude Code; Engineering Owner reviews | Pending scheduling | Open |

The four findings and existing evidence are described in [the architecture acceptance record](S0-05-architecture-acceptance.md) section 11. These task names do not imply external tracker issues have been created.
