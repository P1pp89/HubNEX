"""The table hologram's "blueprints": panels that follow what you ask, as in the films.

The hologram page (/holo) shows Jarvis' core; when a request is about something that can be
seen, a panel takes the stage: the floor plan with the rooms and devices involved, a camera,
the trend of a sensor, a list, a card. Two ways in:
- automatic, from what Jarvis does in the house (a light turned on, a sensor read);
- `holo_show`, a tool Jarvis gets only while a hologram is switched on (no cost otherwise).
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from hubnex.casa import downsample

if TYPE_CHECKING:
    from hubnex.hq import HQ

MERGE_SECONDS = 20  # entities touched within this time end up on the same floor plan
MAX_ITEMS = 12


class Holo:
    def __init__(self, hq: "HQ"):
        self.hq = hq
        self.clients = 0  # hologram pages connected right now
        self._house: list[str] = []
        self._house_at = 0.0

    @property
    def on(self) -> bool:
        return self.clients > 0

    def show(self, scene: dict) -> None:
        if self.on:
            self.hq.emit({"type": "holo", "scene": scene})

    # ------------------------------------------------------------------ scenes
    def _item(self, entity_id: str) -> dict | None:
        c = self.hq.casa.compact(entity_id)
        if not c:
            return None
        return {"id": entity_id, "name": c["n"], "state": c["s"], "unit": c["a"].get("unit_of_measurement"),
                "area": self.hq.watcher.area_of(entity_id)}

    def house_scene(self, entity_ids: list[str], title: str | None = None, areas: list[str] | None = None) -> dict:
        """The floor plan with the rooms and the devices involved lit up. Without a floor plan:
        a card with the devices."""
        items = [i for i in (self._item(e) for e in entity_ids[:MAX_ITEMS]) if i]
        focus = {i["area"] for i in items if i["area"]}
        names = {(a.get("name") or aid).lower(): aid for aid, a in self.hq.watcher.areas.items()}
        for a in areas or []:  # rooms named by Jarvis: by id or by name
            aid = a if a in self.hq.watcher.areas else names.get(str(a).lower())
            if aid:
                focus.add(aid)
        floors = self.hq.casa.build().get("floors") or []
        # The floor with most of what is involved.
        floor = max(floors, key=lambda f: sum(r.get("area_id") in focus for r in f["rooms"]), default=None)
        if not floor:
            return {"kind": "card", "title": title or "Casa",
                    "fields": [[i["name"], f"{i['state']} {i['unit'] or ''}".strip()] for i in items]}
        area_names = {aid: (a.get("name") or aid) for aid, a in self.hq.watcher.areas.items()}
        return {
            "kind": "house",
            "title": title or floor["name"],
            "aspect": floor.get("aspect", 1.4),
            "rooms": [{"id": r.get("area_id"), "name": r["name"], "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"]}
                      for r in floor["rooms"]],
            "focus": sorted(a for a in focus if a),
            "items": [{**i, "room": area_names.get(i["area"] or "")} for i in items],
        }

    async def chart_scene(self, entity_id: str, hours: int = 24, title: str | None = None) -> dict:
        raw = await self.hq.ha.history([entity_id], max(1, min(hours, 168)))
        item = self._item(entity_id) or {"name": entity_id, "unit": None, "state": None}
        return {"kind": "chart", "title": title or item["name"], "unit": item["unit"], "now": item["state"],
                "hours": hours, "points": downsample(raw.get(entity_id, []), 72)}

    def camera_scene(self, entity_id: str, title: str | None = None) -> dict:
        item = self._item(entity_id)
        return {"kind": "camera", "entity": entity_id, "title": title or (item["name"] if item else entity_id)}

    # ------------------------------------------------------------------ automatic
    def touched(self, entity_ids: list[str]) -> None:
        """Jarvis read or changed these: show them (with what he touched a moment ago)."""
        if not self.on:
            return
        ids = [e for e in entity_ids if isinstance(e, str) and "." in e]
        if not ids:
            return
        if len(ids) == 1 and ids[0].startswith(("camera.", "image.")):
            self.show(self.camera_scene(ids[0]))
            return
        now = time.monotonic()
        if now - self._house_at > MERGE_SECONDS:
            self._house = []
        self._house = list(dict.fromkeys(self._house + ids))[-MAX_ITEMS:]
        self._house_at = now
        try:
            self.show(self.house_scene(self._house))
        except Exception:  # the hologram is a bonus: never break the request for it
            pass


def targets(data: dict | None, changed: list[dict] | None = None) -> list[str]:
    """The entities a service call is about: its entity_id(s) and what Home Assistant says changed."""
    out: list[str] = []
    eid = (data or {}).get("entity_id")
    if isinstance(eid, str):
        out += [e.strip() for e in eid.split(",")]
    elif isinstance(eid, list):
        out += [e for e in eid if isinstance(e, str)]
    out += [c["entity_id"] for c in changed or [] if c.get("entity_id")]
    return list(dict.fromkeys(out))
