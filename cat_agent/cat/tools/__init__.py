"""Tool registry: every function in TOOLS is advertised to the LLM.

To add a tool:
  1. Write an async function in a module here (see basics.py for the pattern).
  2. Import it below and add it to TOOLS.

Planned tool modules for the CAT use case (not built yet):
  - tasks.py     -> get_todays_tasks, mark_task_done           (daily task dashboard)
  - safety.py    -> get_seatbelt_status, get_proximity_alerts,
                    log_incident                               (safety features)
  - telemetry.py -> get_machine_status, get_idle_time          (unusual behaviour)
  - estimate.py  -> estimate_task_duration                     (task time estimation)

Heavier, multi-step jobs belong in cat/specialists/ and get exposed here as a
single tool - see cat/specialists/__init__.py.
"""

from cat.specialists.machine_expert import ask_machine_expert
from cat.tools.basics import get_current_time
from cat.tools.manual import open_manual
from cat.tools.screen import ask_about_screen

TOOLS = [
    get_current_time,
    ask_machine_expert,  # specialist agent over the official Cat 320D manual
    open_manual,  # "open it": show the pages behind the last manual answer
    ask_about_screen,  # "what does this button do?" about a paused video or a photo
]
