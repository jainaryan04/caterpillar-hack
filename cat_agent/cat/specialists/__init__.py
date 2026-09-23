"""Specialist agents (OpenAI Agents SDK), exposed to the voice loop as tools.

Why not make the voice LLM do everything? It has to answer in well under a
second. Anything slow or multi-step (manual lookup, task planning, incident
report writing, vision) goes to a specialist agent here, and the voice LLM
just calls it like any other tool.

To switch an agent on, import its tool function in cat/tools/__init__.py and
add it to TOOLS, e.g.:

    from cat.specialists.machine_expert import ask_machine_expert
    TOOLS = [get_current_time, ask_machine_expert]

Planned agents (not built yet):
  - scheduler  -> reads/updates the day's tasks, estimates durations
  - safety     -> watches safety signals, writes incident logs
  - trainer    -> quizzes the operator, recommends training modules
  - vision     -> answers "what is this button?" from the cab camera
"""
