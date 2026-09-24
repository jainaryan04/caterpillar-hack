"""Live telemetry surface for the frontend: machine GPS/geofence state, zones,
and safety alerts (Phase 7/8 tables: machines' lat/lng/telemetry columns,
`zones`, `machine_safety_events`).

New router, mounted from `main.py` under `/v2` alongside the untouched `/v1`
routes -- nothing here shares a path with, or changes the behaviour of,
anything in `main.py`. Scheduling itself (plan/predict/runs/assignments)
already has everything it needs in `/v1`; this file exists only because v1
has no route at all for raw GPS/zone/alert data, which lives in tables no
existing endpoint reads.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .store import store

router = APIRouter(prefix="/v2", tags=["live"])


def _need_db():
    if not store.enabled:
        raise HTTPException(503, "DATABASE_URL is not configured; live telemetry unavailable")


@router.get("/machines", summary="Live GPS position, telemetry and geofence status for every machine")
def live_machines():
    _need_db()
    return {"machines": store.list_live_machines()}


@router.get("/zones", summary="Site geofence polygons: work areas and restricted zones")
def zones():
    _need_db()
    return {"zones": store.list_zones()}


@router.get("/alerts", summary="Safety events: proximity, tilt/rollover/fall, geofence, restricted zone")
def alerts(status: str | None = Query(None, pattern="^(OPEN|ACKNOWLEDGED|RESOLVED)$"),
           limit: int = Query(300, ge=1, le=1000)):
    _need_db()
    return {"alerts": store.list_alerts(status, limit)}


class AlertStatusUpdate(BaseModel):
    status: str
    note: str | None = None


@router.patch("/alerts/{alert_id}", summary="Acknowledge or resolve a safety event")
def update_alert(alert_id: int, body: AlertStatusUpdate):
    _need_db()
    if body.status not in ("ACKNOWLEDGED", "RESOLVED"):
        raise HTTPException(422, "status must be ACKNOWLEDGED or RESOLVED")
    try:
        return store.set_alert_status(alert_id, body.status, body.note)
    except LookupError:
        raise HTTPException(404, f"no alert {alert_id}") from None
