# UX review brief (user request, 2026-10-17) — run AFTER round 2 and Inflate v2 land

Use an Opus / xhigh subagent that acts like a USER of the system (drives the real app in Chromium via Playwright,
reads nothing but what the UI shows) and looks for UX issues. The user's use case:
- define kb articles over time
- add features they want to get to
- define high-level projects (e.g. game mods) that encompass ideas/tasks/features/kb
- anywhere data can be linked between datasets, there must be a way to do that IN THE UI (not by editing raw
  markdown / frontmatter / yaml)
- a smooth path all the way from defining the data → linking data together → setting up contexts → inflating them to
  something usable by agents (a working directory + LLM_CONTEXT.md)

Output: a prioritized findings report (severity, where, what happened, what the user expected, suggested fix) written
to plans/UX_REVIEW_FINDINGS.md, then the orchestrator turns the top findings into coding packets.
