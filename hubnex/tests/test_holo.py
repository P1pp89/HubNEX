"""The table hologram's blueprints: panels that follow the request."""

from __future__ import annotations

from fastapi.testclient import TestClient

from hubnex.holo import targets
from hubnex.main import create_app
from hubnex.tools import REGISTRY, ToolContext
from tests import test_casa as T
from tests.conftest import response, text_block


def drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


async def with_house(hq):
    w, ws, task = await T.connected()
    hq.watcher = hq.casa.ha = w
    hq.casa.save_layout(T.LAYOUT)
    return task


async def test_touched_entities_light_up_on_the_floor_plan(make_hq):
    hq = make_hq([])
    task = await with_house(hq)
    events = hq.subscribe()
    hq.holo.touched(["light.lampada"])
    assert drain(events) == []  # no hologram on: nothing is built or sent
    hq.holo.clients = 1
    hq.holo.touched(["light.lampada"])
    hq.holo.touched(["light.lampadario"])  # a moment later: same plan, both lit
    scene = [e for e in drain(events) if e["type"] == "holo"][-1]["scene"]
    assert scene["kind"] == "house" and scene["title"] == "Piano terra"
    assert scene["focus"] == ["sala", "soggiorno"]
    assert [i["id"] for i in scene["items"]] == ["light.lampada", "light.lampadario"]
    assert scene["items"][0]["room"] == "Soggiorno" and scene["items"][0]["state"] == "off"
    assert {r["name"] for r in scene["rooms"]} >= {"Soggiorno", "Sala da Pranzo"}
    task.cancel()


async def test_holo_show_tool(make_hq):
    hq = make_hq([])
    ctx = ToolContext(hq, "jarvis", None)
    run = REGISTRY["holo_show"].handler
    assert "spento" in await run(ctx, {"kind": "list", "items": ["a"]})
    hq.holo.clients = 1
    events = hq.subscribe()
    await run(ctx, {"kind": "card", "title": "Meteo", "fields": {"Pioggia": "70%"}, "text": "Ombrello."})
    await run(ctx, {"kind": "list", "title": "Scadenze", "items": ["F24", "Bollo"]})
    assert (await run(ctx, {"kind": "camera", "entities": ["light.x"]}))["errore"]
    scenes = [e["scene"] for e in drain(events)]
    assert scenes == [
        {"kind": "card", "title": "Meteo", "text": "Ombrello.", "fields": [["Pioggia", "70%"]]},
        {"kind": "list", "title": "Scadenze", "items": ["F24", "Bollo"]},
    ]


async def test_jarvis_gets_the_tool_only_while_a_hologram_is_on(make_hq):
    hq = make_hq([response([text_block("Ciao.")], "end_turn"), response([text_block("Ciao.")], "end_turn")])
    names = lambda i: [t["name"] for t in hq.client.requests[i]["tools"]]  # noqa: E731
    await hq.chat("dashboard", "ciao")
    hq.holo.clients = 1
    await hq.chat("dashboard", "ciao")
    assert "holo_show" not in names(0) and "holo_show" in names(1)


def test_hologram_page_counts_as_a_hologram(settings, make_hq):
    hq = make_hq([])
    with TestClient(create_app(settings, hq=hq, start_workers=False)) as client:
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            assert not hq.holo.on  # the dashboard is not a hologram
        with client.websocket_connect("/ws?holo=1") as ws:
            ws.receive_json()
            assert hq.holo.on
    assert hq.holo.clients == 0


def test_service_targets():
    assert targets({"entity_id": "light.a, light.b"}, [{"entity_id": "light.c"}]) == ["light.a", "light.b", "light.c"]
    assert targets({"entity_id": ["light.a"]}, [{"entity_id": "light.a"}]) == ["light.a"]
    assert targets(None) == []
