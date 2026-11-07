"""Jarvis' tool for the table hologram: a "blueprint" panel next to his answer."""

from __future__ import annotations

from hubnex.tools import ToolContext, tool

MAX = 10


@tool(
    "holo_show",
    "Mostra un pannello sull'ologramma da tavolo dell'utente (è acceso ora), come un blueprint "
    "accanto alla tua risposta. Usalo quando un'immagine aiuta: kind=house piantina con stanze "
    "(`areas`) e dispositivi (`entities`) evidenziati; kind=camera una telecamera (`entities`: "
    "[camera.x]); kind=chart l'andamento di un sensore nelle ultime `hours` ore (`entities`: "
    "[sensor.x]); kind=list un elenco (`items`: scadenze, email, passaggi, risultati); kind=card una "
    "scheda con `fields` (etichetta → valore) e `text` breve (meteo, riepilogo di una ricerca, un "
    "preventivo, un agente al lavoro); kind=clear torna al nucleo. Testi brevi: è un pannello, non "
    "la risposta. Le azioni in casa compaiono già da sole sulla piantina.",
    {
        "kind": {"type": "string", "enum": ["house", "camera", "chart", "list", "card", "clear"]},
        "title": {"type": "string"},
        "entities": {"type": "array", "items": {"type": "string"}},
        "areas": {"type": "array", "items": {"type": "string"}, "description": "Nomi o id delle stanze"},
        "hours": {"type": "integer"},
        "items": {"type": "array", "items": {"type": "string"}},
        "fields": {"type": "object", "description": "es. {\"Temperatura\": \"18 °C\", \"Pioggia\": \"70%\"}"},
        "text": {"type": "string"},
    },
    ["kind"],
)
async def holo_show(ctx: ToolContext, inp: dict):
    holo = ctx.hq.holo
    if not holo.on:
        return "L'ologramma è spento: rispondi normalmente."
    kind, title = inp["kind"], (inp.get("title") or "")[:80] or None
    entities = [e for e in inp.get("entities") or [] if isinstance(e, str)][:MAX]
    if kind in ("house", "camera", "chart") and not ctx.hq.watcher.enabled:
        return {"errore": "Home Assistant non configurato: usa card o list."}
    if kind == "house":
        scene = holo.house_scene(entities, title, inp.get("areas"))
    elif kind == "camera":
        if not entities or not entities[0].startswith(("camera.", "image.")):
            return {"errore": "Serve una telecamera in entities, es. [\"camera.ingresso\"]."}
        scene = holo.camera_scene(entities[0], title)
    elif kind == "chart":
        if not entities:
            return {"errore": "Serve un sensore in entities, es. [\"sensor.temperatura_salotto\"]."}
        scene = await holo.chart_scene(entities[0], int(inp.get("hours") or 24), title)
        if not scene["points"]:
            return {"errore": f"Nessun dato numerico per {entities[0]} nelle ultime ore."}
    elif kind == "list":
        scene = {"kind": "list", "title": title or "", "items": [str(i)[:120] for i in (inp.get("items") or [])][:MAX]}
    elif kind == "card":
        fields = inp.get("fields") if isinstance(inp.get("fields"), dict) else {}
        scene = {"kind": "card", "title": title or "", "text": (inp.get("text") or "")[:400],
                 "fields": [[str(k)[:40], str(v)[:60]] for k, v in list(fields.items())[:MAX]]}
    else:
        scene = {"kind": "clear"}
    holo.show(scene)
    return "Mostrato sull'ologramma."
