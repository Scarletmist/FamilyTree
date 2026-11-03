---
name: contrastive-analysis
description: Explain what harness edits changed by comparing baseline and candidate trajectories and outputs. Use after probes and before composing a refined harness; separate mechanism evidence from noise and correlation.
---

# Contrastive behavioral analysis

1. Read each actual artifact, trace and edit rather than relying on proposal claims or passing test summaries. Use `harness/templates/contrast.md` to tie observations to exact run IDs and file/trace locations.
2. Treat the base set as repeated draws from one procedure. Count repeated failure patterns and distinguish isolated events; a single candidate execution is weak evidence of general benefit.
3. For each edit identify the intended mechanism, earliest observed changed action, consequent artifact difference, downside, competing explanation and confidence. Agreement between candidates sharing the same model and evidence is not independent proof.
4. Separate application-code effects from instruction effects. Two successful regressions on an already repaired program cannot establish a workflow benefit. Mark such claims untested and request a fresh probe within the existing budget.
5. Inspect non-delivery and empty artifacts especially closely. Never launder an edit associated with missing output into a composition without stating why the wider evidence supports that risk.
6. Assign each edit keep, revise, drop or insufficient-evidence. Use only observed source-backed facts; report unresolved contradictions instead of majority voting. Do not read withheld evaluation outcomes to select a narrative.
7. Return a bounded composition recommendation, including KEEP_CURRENT or restoring an earlier checkpoint when supported. Stop collecting probes when the agreed budget is exhausted; retain uncertainty in the decision.
