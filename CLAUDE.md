# AGENTS.md

## 1. Purpose

This file defines **how coding agents should work in this repository**.

It is intentionally not the gameplay specification.

For gameplay, product behavior, match rules, player/robot roles, Time-out behavior, tactical scripts, robot personality, tactical capacity, imperfect adherence, playbook behavior, and the intended skill loop, read **`docs/GAMEPLAY.md`**.

Do not duplicate or independently reinterpret gameplay requirements here.

---

## 2. Source-of-truth order

When instructions appear to conflict, use this order:

1. **The user's current explicit request**.
2. **`docs/GAMEPLAY.md`** for gameplay/product intent.
3. **The actual repository** for current implementation facts, architecture, scripts, APIs, dependencies, and conventions.
4. **This `AGENTS.md`** for engineering workflow and constraints.
5. **Relevant project skills** for specialized procedures and implementation guidance.

Important consequences:

- If a new user request intentionally changes gameplay, the new request wins. Update `docs/GAMEPLAY.md` when the gameplay decision has materially changed so the repo does not keep two conflicting product truths.
- If `docs/GAMEPLAY.md` says what the game should do but the code does something else, treat that as an implementation gap unless the user explicitly says the document is outdated.
- If this file contains an example that conflicts with `docs/GAMEPLAY.md`, follow `docs/GAMEPLAY.md`.
- Do not infer current gameplay requirements from old chat history when `docs/GAMEPLAY.md` already captures the consolidated design.

---

## 3. Project mission and fixed technology constraints

Build a browser-based 3D robot fighting game with **Three.js** and **pnpm**.

The product may evoke the fantasy of robot-boxing fiction, but use original robots, names, visuals, arenas, UI, audio, lore, animation, and branding. Do not copy protected characters or assets.

Technology rules:

- Use **Three.js** for 3D rendering.
- Use **pnpm** for package management.
- Do not switch to npm, yarn, or bun for project dependency management.
- Preserve the existing framework, build tool, TypeScript/JavaScript choice, folder conventions, and architecture unless a requested change or concrete engineering benefit justifies changing them.
- Do not migrate to React, React Three Fiber, ECS, another renderer, or another engine merely because it is familiar.
- Prefer the smallest reasonable dependency set.
- Reuse existing browser/repository capabilities before adding packages.
- If the project already has a physics solution, reuse it when reasonable. If it does not, do not add a physics engine merely because the game contains combat.

---

## 4. Required reading before meaningful gameplay work

Before implementing or changing gameplay behavior:

1. Read `docs/GAMEPLAY.md`.
2. Inspect `package.json` and `pnpm-lock.yaml`.
3. Inspect the relevant entry points and nearby `src` code.
4. Read relevant README/config/documentation files.
5. Search for existing systems/utilities before creating replacements.
6. Check `git status` before broad edits.
7. Check available project skills and load only the skill(s) that actually match the task.

Do not begin from an imagined architecture when the repository can answer the question.

---

## 5. Skill usage policy

Project skills are specialized playbooks. Use them to improve reliability, but do not treat them as a competing source of gameplay requirements.

### 5.1 General rules for skills

- When a task clearly matches a project skill, **read that skill's `SKILL.md` before implementing the matching part of the task**.
- Load skills progressively. Do **not** read every skill for every task.
- Prefer the most specific applicable skill over a broad/general skill.
- Use multiple skills only when the task genuinely spans multiple concerns.
- A skill may define process, validation, debugging, or implementation patterns, but it must not override `docs/GAMEPLAY.md`.
- If a skill assumes an architecture that does not match the repository, adapt the guidance rather than forcing the repository to match the skill.
- If a skill conflicts with a current explicit user request, follow the user request.
- If the skill's instructions produce a meaningful technical trade-off, surface the trade-off instead of silently choosing the most complex option.

### 5.2 Suggested routing by task

Use the following as routing guidance, not as a requirement to invoke every listed skill.

| Task                                                    | Prefer these skills                                           |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Understand a new task, plan a multi-system change       | `planning-and-task-breakdown`, `context-engineering`          |
| Implement from a written requirement/spec               | `spec-driven-development`, `source-driven-development`        |
| Small safe changes in an existing codebase              | `incremental-implementation`                                  |
| API, event, data-contract, or boundary design           | `api-and-interface-design`                                    |
| Core Three.js/gameplay architecture                     | `threejs-gameplay-systems`, `threejs-game-director`           |
| Action combat, attack states, hit rules, cancel windows | `design-action-combat`                                        |
| Enemy/opponent behavior                                 | `build-threejs-enemy-systems`, `tune-enemy-ai`                |
| Camera behavior                                         | `build-game-camera-controls`                                  |
| Three.js performance                                    | `optimize-threejs-games`, `threejs-debug-profiler`            |
| Reproduce/fix a bug                                     | `debugging-and-error-recovery` plus the relevant domain skill |
| Add or change behavior with strong regression risk      | `test-driven-development` where practical                     |
| Browser/gameplay smoke testing                          | `test-playable-web-games`                                     |
| Code review/refactor quality                            | `code-review-and-quality`                                     |
| Security, secrets, untrusted model output               | `security-and-hardening`                                      |
| Release/readiness verification                          | `threejs-qa-release`                                          |
| Unsure how the local skill system should be used        | `using-agent-skills`                                          |

### 5.3 Examples

**Example: implement robot counter behavior**

Read `docs/GAMEPLAY.md`, then use `design-action-combat` and the relevant Three.js/gameplay skill. If this also changes opponent decision-making, add `tune-enemy-ai` or `build-threejs-enemy-systems`.

**Example: Time-out tactical-script editor**

Read `docs/GAMEPLAY.md`, then use `spec-driven-development` plus `api-and-interface-design`. Add `security-and-hardening` if model-generated structured data crosses a trust boundary.

**Example: frame-rate drop during a two-robot fight**

Use `threejs-debug-profiler` first to measure. Use `optimize-threejs-games` for the fix. Do not redesign combat AI before profiling establishes it as the bottleneck.

**Example: camera feels bad during knockdowns**

Use `build-game-camera-controls`; do not alter combat rules merely to make the camera easier to implement.

---

## 6. Core implementation invariants derived from the gameplay

The details live in `docs/GAMEPLAY.md`, but several engineering boundaries are important enough to protect explicitly.

### 6.1 Continuous local combat autonomy

The robot's local combat system must remain capable of fighting without waiting for player speech, a network request, or an LLM response.

Never build this architecture:

```text
player prompt -> remote model -> one move -> robot waits -> next prompt
```

The normal direction is:

```text
game state
+ robot personality/capability
+ tactical playbook
+ current blackboard state
+ optional direct command
        ↓
local combat decision system
        ↓
legal action intent
        ↓
combat simulation
        ↓
animation / rendering
```

The exact AI technique is intentionally not fixed. Utility AI, behavior trees, GOAP, FSMs, or hybrids are implementation choices unless a task explicitly selects one.

### 6.2 Live Fight and Time-out are different command surfaces

Do not collapse all natural-language input into one generic persistent-strategy API.

Follow `docs/GAMEPLAY.md`:

- **Live Fight** can produce live coaching effects such as Direct Commands and Blackboard Overrides.
- **Live Fight must not silently create or rewrite persistent tactical script logic.**
- **Time-out** is the surface for inspecting, creating, editing, reviewing, and committing tactical script/playbook changes.

If an implementation makes a live utterance permanently rewrite the playbook, it is violating the current gameplay design unless the user explicitly changes that rule.

### 6.3 Direct Commands are requests, not animation triggers

A direct command may strongly influence action selection, but it cannot bypass:

- current action/recovery state;
- range;
- stamina/energy;
- cooldowns;
- stagger/knockdown;
- facing/arena constraints;
- explicit cancellation rules;
- physical/gameplay legality.

Do not implement:

```text
"right hook" -> directly play hook animation -> apply damage
```

Instead, represent the command as intent that the local combat system can execute, defer briefly, or reject/expire according to game rules.

### 6.4 Blackboard is working state, not the permanent playbook

The blackboard represents current/temporary tactical intent and working memory.

Do not use it as a hidden substitute for persistent tactical-script editing when the gameplay calls for a Time-out.

### 6.5 Tactical scripts are constrained game data

Dynamic tactical scripts are a gameplay mechanic, but they must not become arbitrary executable code.

Do not use `eval`, `Function`, generated JavaScript, generated shell commands, or unrestricted code execution for tactical scripts.

Represent tactics using constrained, validated game-domain data such as:

- conditions;
- goals;
- phases;
- triggers;
- sequences;
- priorities;
- timers;
- repeat limits;
- branches;
- abort conditions.

The exact schema/DSL is an implementation decision. Keep it inspectable, serializable, versionable, validateable, and safe.

### 6.6 Strategy does not replace motor/combat legality

Tactical logic should describe what the robot is trying to accomplish, not micromanage joints, hit detection, or animation frames.

The local combat layer decides concrete execution appropriate to that robot's current capabilities and state.

### 6.7 LLM/model boundary

A model may help interpret natural language or propose tactical-script patches, but it is never authoritative over simulation invariants.

The model must not directly:

- mutate Three.js scene objects as its gameplay API;
- calculate authoritative hit results;
- apply damage;
- set physics transforms every frame;
- bypass action legality;
- execute arbitrary generated code;
- become a required dependency for every combat decision tick.

Validate all model output as untrusted external data.

---

## 7. Recommended system boundaries

Keep these responsibilities separated even when the implementation is small.

### Rendering

Owns Three.js scene/view concerns:

- renderer, camera, lights, shadows;
- model/animation presentation;
- VFX;
- interpolation/presentation of simulation state;
- debug visualization.

Rendering must not own authoritative combat rules.

### Simulation / combat domain

Owns authoritative game state and legality:

- transforms/arena constraints as appropriate;
- health/stamina/energy;
- startup/active/recovery state;
- hitboxes/hurtboxes or equivalent hit resolution;
- damage/block/stagger/knockdown;
- cooldowns;
- action cancellation/preemption rules;
- round/match state.

### Autonomous combat decision layer

Owns continuous action selection using current game state plus the robot's personality, capabilities, playbook, blackboard, and live command intent.

It must function when the voice/LLM layer is offline.

### Tactical/playbook layer

Owns validated persistent tactic definitions and their runtime state.

Keep the **definition** of a tactic separate from ephemeral execution state where practical.

### Command interpretation

Owns converting speech/text into constrained domain intent.

Live-Fight interpretation and Time-out editing may share infrastructure, but they have different allowed outputs. Enforce that boundary in code rather than relying only on prompting.

### UI/input

Owns:

- voice/text capture;
- transcript/interpretation feedback;
- Time-out editing/review/commit UI;
- HUD/status;
- non-blocking provider/network status.

Input/UI must not directly mutate combat truth behind the domain layer.

---

## 8. Async, latency, and failure behavior

Network/model latency must not stall combat.

For async command/model operations:

- keep combat running;
- reject stale results that would overwrite newer intent;
- attach request/version ids where needed;
- support cancellation when the provider/API allows it;
- preserve the last valid state on malformed output;
- show non-blocking failure/interpretation feedback;
- make obvious local behavior independent of network availability where practical.

Do not assume a fixed cloud latency budget as a gameplay invariant.

For latency-sensitive live commands, prefer a deterministic/local fast path when the command can be recognized with sufficiently high confidence, provided it still produces the same validated domain-level command shape.

---

## 9. Security requirements

- Never commit API keys, auth tokens, credentials, or private `.env` values.
- Do not put secret provider keys into browser bundles or public client environment variables.
- Treat model output as untrusted data.
- Validate enums, numeric ranges, collection sizes, ids, and schema versions.
- Escape generated/player-facing text appropriately; never inject raw generated HTML.
- Never execute model-generated source code or shell commands as a combat mechanic.
- Set reasonable network timeouts.
- Protect against stale async responses.
- Handle asset/model load failures gracefully.
- Keep the match functional when network/model services fail where the local game systems are sufficient.

When security is materially involved, use the `security-and-hardening` skill.

---

## 10. Performance rules

Do not put network or model calls in render/simulation hot loops.

Avoid in per-frame/hot paths unless measured and justified:

- repeated object/array allocation;
- repeated creation of geometries/materials/textures;
- unnecessary scene traversal;
- heavy synchronous parsing;
- DOM writes every frame;
- expensive generic raycasts when a cheaper combat-domain calculation works;
- recreating animation mixers or other reusable objects.

Profile before substantial optimization. For Three.js performance problems, use `threejs-debug-profiler` before guessing and `optimize-threejs-games` for targeted remediation.

---

## 11. Determinism, observability, and reproducibility

Where practical:

- use simulation/game time for gameplay durations;
- isolate randomness behind seeded RNG when deterministic replay/testing matters;
- make important combat decisions inspectable/loggable;
- keep raw transcript separate from validated interpreted intent when useful;
- record validated command/tactical events so replay/debugging does not require re-querying a model;
- prefer small typed/domain event logs over prematurely building a large event-sourcing framework.

The purpose is reproducible bugs, balancing, tests, and possible future replay—not architecture for its own sake.

---

## 12. Testing policy

Test rules below the renderer whenever practical.

High-value tests depend on the changed system, but commonly include:

- combat action legality;
- startup/active/recovery timing;
- stamina/energy rules;
- hit/block/stagger resolution;
- direct-command execution/defer/expiry behavior;
- blackboard override application and removal;
- tactical-script schema validation;
- tactic trigger/branch/abort behavior;
- tactical capacity/adherence logic when implemented;
- stale async result rejection;
- provider/model failure fallback;
- fixed-step simulation behavior;
- deterministic scenarios under seeded randomness.

For gameplay integration, verify relevant flows such as:

- robots continue fighting with no player input;
- a live command changes current behavior without rewriting the playbook;
- a blackboard override is temporary/current-state behavior;
- a tactical script cannot be modified through the Live Fight path;
- a Time-out edit can be reviewed before commit when that UI exists;
- committed tactics affect later local combat decisions;
- invalid/impossible commands do not freeze or corrupt the match;
- model/network failure does not stop autonomous combat.

Follow the repository's existing test stack. Do not add a heavy framework for one trivial test.

For browser/playability checks, use `test-playable-web-games` when available.

---

## 13. Development workflow

For a meaningful implementation task:

1. Read the relevant source-of-truth files and code.
2. Load only the relevant skills.
3. State a compact plan when the task spans multiple systems.
4. Make the smallest coherent change that satisfies the task.
5. Reuse existing abstractions before creating new ones.
6. Add or update tests where the regression risk justifies them.
7. Run the relevant existing checks.
8. Smoke-test the affected gameplay/browser flow when practical.
9. Fix failures caused by the change.
10. Report what changed, what was verified, and meaningful remaining limitations.

Do not stop repeatedly for permission on routine reversible decisions.

Ask for human input only when the choice is genuinely product-defining, destructive, secret-dependent, or cannot be resolved from the task/repository.

---

## 14. Validation commands

Inspect `package.json` first. Never invent scripts.

Use **pnpm only**.

Typical commands may include:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run only scripts that actually exist.

If the repository provides a combined validation command, prefer it when appropriate.

A successful build is not sufficient for a gameplay change that can reasonably be smoke-tested in the browser.

---

## 15. Code quality rules

- Prefer clarity over cleverness.
- Follow existing language/framework conventions.
- Preserve architecture unless a concrete need justifies change.
- Keep modules focused with clear ownership.
- Avoid giant managers that own rendering, combat, AI, UI, assets, and networking at once.
- Avoid premature abstraction.
- Prefer explicit types at trust/system boundaries.
- If TypeScript is used, prefer `unknown` + validation over `any` for untrusted data.
- Centralize gameplay tuning values instead of scattering magic numbers.
- Keep mutable shared state narrow and intentional.
- Comment _why_, not obvious syntax.
- Avoid unrelated mass formatting.
- Do not edit `pnpm-lock.yaml` unless dependencies actually changed.
- Do not fabricate files, APIs, package versions, scripts, or runtime behavior.

---

## 16. Reasoning and truthfulness

Prioritize factual correctness over agreement.

When materially relevant:

- challenge incorrect assumptions;
- identify hidden constraints;
- distinguish confirmed facts from inference/assumption;
- discuss meaningful trade-offs;
- consider performance, maintainability, security, complexity, testing, and developer experience;
- identify edge cases/failure modes;
- say when something cannot be verified;
- prefer a simpler solution when it solves the real problem.

Do not argue for the sake of disagreement.

Do not claim success just because code was written.

---

## 17. Definition of done

A change is done only when, as applicable:

- it satisfies the user's requested behavior;
- it remains consistent with `docs/GAMEPLAY.md`, or `docs/GAMEPLAY.md` was intentionally updated for a new gameplay decision;
- it integrates with the existing architecture rather than creating an unnecessary parallel system;
- autonomous combat still runs without waiting for player/model input;
- Live Fight and Time-out capability boundaries are preserved;
- tactical scripts remain constrained validated game data;
- combat legality/simulation remains authoritative;
- async/model failure cannot corrupt or stall core combat;
- secrets are not exposed;
- relevant tests/checks pass if available;
- the affected browser/gameplay flow was smoke-tested when practical;
- important limitations are reported explicitly.

---

## 18. Product/engineering decision heuristic

When multiple implementations satisfy the same current gameplay requirement, prefer the option that best preserves:

1. the gameplay described in `docs/GAMEPLAY.md`;
2. readable, responsive robot combat;
3. robot autonomy rather than puppeteering;
4. a clear Live Fight vs Time-out boundary;
5. safe and inspectable tactical programming;
6. deterministic/testable combat rules;
7. graceful degradation when network/model services fail;
8. maintainable boundaries between input, tactical state, combat AI, simulation, rendering, and UI;
9. iteration speed;
10. visual polish after the above are sound.

Do not optimize primarily for "using more AI." Use AI where natural-language understanding and tactic editing materially improve the game; keep authoritative real-time combat local and deterministic enough to test and reason about.
