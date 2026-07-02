"""
Share/upload endpoints for finished-game replays.

POST /api/uploads       — store a full replay payload, returns {"id": <share code>}
GET  /api/uploads/{id}  — fetch a stored payload for replay hydration

The payload is the frontend's SavedGame JSON verbatim (sgf, scoreHistory,
deadStones, selectorLog, ...). The server treats it as opaque — the few
queryable columns arrive alongside it in the request body.
"""

from __future__ import annotations
import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.uploads import storage

router = APIRouter()

# A 9x9 replay with score history + selector logs is tens of KB; a 19x19 with
# everything attached stays well under 1 MB. Anything bigger is malformed.
MAX_PAYLOAD_BYTES = 1_000_000


class UploadRequest(BaseModel):
    payload: dict[str, Any]
    player_name: Optional[str] = None
    board_size: Optional[int] = None
    opponent_rank: Optional[str] = None
    result: Optional[str] = None


@router.post("")
async def upload_game(req: UploadRequest):
    payload_json = json.dumps(req.payload)
    if len(payload_json.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Replay payload too large")
    if not req.payload.get("sgf"):
        raise HTTPException(status_code=400, detail="Replay payload missing sgf")
    share_id = await storage.save_upload(
        payload_json,
        player_name=req.player_name,
        board_size=req.board_size,
        opponent_rank=req.opponent_rank,
        result=req.result,
    )
    return {"id": share_id}


@router.get("/{share_id}")
async def get_uploaded_game(share_id: str):
    normalized = share_id.strip().upper()
    payload_json = await storage.get_upload(normalized)
    if payload_json is None:
        raise HTTPException(status_code=404, detail="Shared game not found")
    return {"id": normalized, "payload": json.loads(payload_json)}
