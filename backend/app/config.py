"""
Configuration and constants for the Catapult Activity/Athlete Reporting
dashboard.

IMPORTANT — read this before your first real run:
The exact column names the Catapult Connect v6 `/stats` endpoint returns
for a given `group_by` can vary slightly between accounts/regions (e.g.
`activity_id` vs `activity`, `athlete_name` vs `name`). Rather than
hard-coding one guess, `catapult_client.normalize_stats_columns()` below
renames whichever of a small set of CANDIDATE names it finds into one
canonical name the rest of the app relies on.

If a table on the Reporting or Averages tab looks empty/wrong after your
first "Fetch Data", open the **Data Check** panel in the app (or call
`GET /api/debug/last-fetch`) to see the raw column names Catapult actually
returned, then add whatever name you see to the relevant list below.
"""
import os

# Catapult Connect v6 regions: base API url.
REGION_CONFIG = {
    "APAC": "https://connect-au.catapultsports.com/api/v6",
    "CHINA": "https://connect-cn.catapultsports-cn.com/api/v6",
    "EMEA": "https://connect-eu.catapultsports.com/api/v6",
    "NAM": "https://connect-us.catapultsports.com/api/v6",
}

DEFAULT_REGION = os.environ.get("CATAPULT_DEFAULT_REGION", "APAC")

# The raw parameters requested from the /stats "cached_stats" source.
# These are the exact Catapult field names the frontend's derived-metric
# calculations (frontend/src/utils/aggregate.js — ported from the provided
# Power Query M code) expect to find on every row. Add more raw parameter
# names here if you add more derived calculations on the frontend.
STAT_PARAMETERS = [
    "total_distance",
    "total_duration",
    "total_player_load",
    "max_effort_acceleration",
    "max_effort_deceleration",
    "acceleration_density",
    "total_acceleration_load",
    "percentage_max_velocity",
    "max_vel",
    "velocity_band1_total_distance",
    "velocity_band2_total_distance",
    "velocity_band3_total_distance",
    "velocity_band4_total_distance",
    "velocity_band5_total_distance",
    "velocity_band6_total_distance",
    "velocity_band7_total_distance",
    "velocity_band8_total_distance",
    "velocity2_band7_total_distance",
    "velocity2_band8_total_distance",
    "gen2_acceleration_band1_total_effort_count",
    "gen2_acceleration_band2_total_effort_count",
    "gen2_acceleration_band3_total_effort_count",
    "gen2_acceleration_band6_total_effort_count",
    "gen2_acceleration_band7_total_effort_count",
    "gen2_acceleration_band8_total_effort_count",
]

# Extra parameters requested ONLY if the account's GET /parameters lists
# them (so an account without one never breaks the main /stats call).
# Used by the Session Report tab's "Band Efforts" chart.
OPTIONAL_STAT_PARAMETERS = [
    f"gen2_velocity_band{i}_total_effort_count" for i in range(1, 9)
] + [
    # Drill Report tab ("Accel Density Index" chart).
    "accel_load_density_index",
]

# group_by sent to /stats. Matches: activity, athlete, period, position, team.
STAT_GROUP_BY = ["activity", "athlete", "period", "position", "team"]

# Canonical column name -> list of names Catapult might actually use.
# The FIRST match found in the raw response is renamed to the canonical
# (key) name. Order matters: put the most likely name first.
STATS_COLUMN_CANDIDATES = {
    "activity_id": ["activity_id", "activity"],
    "athlete_id": ["athlete_id", "athlete"],
    "athlete_name": ["athlete_name"],
    "position_name": ["position_name", "position"],
    "period_name": ["period_name", "period"],
    "team_name": ["team_name", "team"],
}

ACTIVITY_COLUMN_CANDIDATES = {
    "id": ["id"],
    "name": ["name"],
    "start_time": ["start_time"],
    "tags": ["tags"],
}
