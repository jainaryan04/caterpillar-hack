"""HTTP surface for the safety services.

Raw JPEG bytes in the request body keeps per-frame overhead down versus multipart or
base64. Teammates building the dashboard can hit these same endpoints directly.
"""

import json
import os
import time
import uuid

import modal

from .common import INCIDENTS_DIR, app, cpu_image, incidents_volume
from .driver_monitor import DriverMonitor
from .front_perception import FrontPerception

api_image = cpu_image.pip_install("fastapi[standard]==0.115.5")


@app.function(
    image=api_image,
    volumes={INCIDENTS_DIR: incidents_volume},
    scaledown_window=300,
    min_containers=1,
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Query, Request
    from fastapi.responses import JSONResponse

    api = FastAPI(title="CAT Smart Operator Assistant — Safety Services")

    @api.get("/health")
    def health():
        return {"status": "ok", "ts": time.time()}

    @api.post("/front")
    async def front(
        request: Request,
        with_depth: bool = Query(True),
        conf: float = Query(0.35),
        hfov_deg: float = Query(70.0),
        cam_height_m: float = Query(2.6),
        corridor_half_width_m: float = Query(2.5),
        max_range_m: float = Query(40.0),
    ):
        payload = await request.body()
        if not payload:
            return JSONResponse({"error": "empty body; POST raw JPEG bytes"}, status_code=400)
        result = FrontPerception().perceive.remote(
            payload,
            with_depth=with_depth,
            conf=conf,
            hfov_deg=hfov_deg,
            cam_height_m=cam_height_m,
            corridor_half_width_m=corridor_half_width_m,
            max_range_m=max_range_m,
        )
        return result

    @api.post("/driver")
    async def driver(request: Request):
        payload = await request.body()
        if not payload:
            return JSONResponse({"error": "empty body; POST raw JPEG bytes"}, status_code=400)
        return DriverMonitor().analyse.remote(payload)

    @api.post("/incident")
    async def incident(request: Request):
        """Append a safety event to the durable incident log."""
        event = await request.json()
        event["id"] = str(uuid.uuid4())
        event.setdefault("ts", time.time())

        os.makedirs(INCIDENTS_DIR, exist_ok=True)
        log_path = os.path.join(INCIDENTS_DIR, "incidents.jsonl")
        with open(log_path, "a") as fh:
            fh.write(json.dumps(event) + "\n")
        incidents_volume.commit()
        return {"logged": True, "id": event["id"]}

    @api.get("/incidents")
    def incidents(limit: int = Query(100)):
        log_path = os.path.join(INCIDENTS_DIR, "incidents.jsonl")
        if not os.path.exists(log_path):
            return {"incidents": []}
        with open(log_path) as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
        return {"incidents": rows[-limit:]}

    return api
