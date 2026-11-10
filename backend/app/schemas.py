"""Pydantic request/response models for the reporting API."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class FetchDataRequest(BaseModel):
    token: str
    region: str = "APAC"
    start_date: str  # YYYY-MM-DD (from the browser's <input type="date">)
    end_date: str    # YYYY-MM-DD


class ActivityOut(BaseModel):
    id: str
    name: str
    date: Optional[str] = None  # YYYY-MM-DD
    start_time: Optional[float] = None  # raw unix timestamp, for exact recency ordering
    tags: List[str] = Field(default_factory=list)


class FetchDataResponse(BaseModel):
    activities: List[ActivityOut]
    # One row per athlete/period/position/team combination, already joined
    # with its activity's name/date/tags. Left loose (List[Dict]) since the
    # exact numeric parameter columns depend on config.STAT_PARAMETERS.
    rows: List[Dict[str, Any]]
    row_count: int
    stats_columns: List[str]  # raw columns Catapult returned, post-normalize


class DebugColumnsResponse(BaseModel):
    activities_columns: List[str]
    stats_columns: List[str]
    sample_stats_rows: List[Dict[str, Any]] = Field(default_factory=list)
