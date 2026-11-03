---
name: executor-adaptation
description: Map proposed prompts, tools, scripts, roles, plugins and hooks onto actual desktop Codex capabilities. Use when a harness proposal changes tool interfaces, delegated roles, runtime integration or execution isolation.
---

# Executor adaptation

1. Use `harness/templates/executor.md` to record the actual host, interpreter, working directory, tool availability, dependency versions, model/app version and effective instruction paths. Mark unobserved values unknown.
2. Map the eight design dimensions individually: project instructions, constraints, memory, tool guidance, roles, skills, deterministic scripts and plugins/hooks. AGENTS can provide project guidance; it cannot replace privileged app system instructions.
3. Prefer existing tools and project dependencies. When adding a script, specify inputs, outputs, errors and required environment. An instruction to use an unavailable tool is not an implementation.
4. For delegated roles, define task-local inputs, editable paths, expected artifacts, stop conditions and context boundaries. Use native delegation only when available and within the current authorization. Otherwise use a fresh task or isolated worktree and report the loss of automation. Independent candidate discovery must not share solutions before its proposal is fixed.
5. For tool/plugin/hook proposals, verify the host's current supported schema before editing. Store proposals under the experiment until validated. Do not infer desktop support from the upstream benchmark's CLI flags or its CODEX_HOME. Do not install providers, bypass approvals, enable hooks or change permissions merely because a skill mentions them.
6. Preserve the starting application revision across workflow probes. Instructions may differ, while source task/data/evaluation remain fixed. For implementation probes, record the intended source difference instead.
7. Record commands, outputs and user-visible action traces in task-local artifacts. Do not claim to capture hidden system prompts, native conversation internals, token costs or desktop thread IDs that the runtime does not expose. Reopen the artifact or run a meaningful smoke check after installing a supported integration.
