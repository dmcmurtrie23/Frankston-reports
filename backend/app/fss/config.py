"""Paths and thresholds shared across the platform."""
from __future__ import annotations

from datetime import date
from pathlib import Path

# Ported from frankston-sport-science-code for the Frankston Reports "This Week" tab.
# Data lives OUTSIDE backend/ (so uvicorn --reload doesn't restart on every pull):
#   Frankston_Reports/sport_science_data/
ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "sport_science_data"
CATAPULT_DIR = DATA / "catapult"
CATAPULT_API_DIR = DATA / "catapult_api"   # what we've pulled from the API (speed summaries only)
SECRETS = DATA / "secrets.toml"   # optional; the app normally passes the token in
CONFIG_DIR = DATA / "config"
CONDITIONING_WORKBOOK = DATA / "testing" / "Frankston Dolphins Conditioning 2026.xlsx"
MAX_VELOCITY_OVERRIDES = CONFIG_DIR / "max_velocity_overrides.csv"
NEEDS_MAX_VELOCITY_TEST = CONFIG_DIR / "needs_max_velocity_test.csv"

# Speed exposure flag
SPEED_EXPOSURE_PCT = 0.90       # fraction of individual max velocity
SPEED_EXPOSURE_DAYS = 10        # flag when longer than this since last exposure
MIN_DWELL_SECONDS = 0.5         # needs 10Hz data; summary exports can't check it. Use 0.3, 0.5 or 1.0

# Catapult API
CATAPULT_REGION = "au"          # connect-au.catapultsports.com
API_SYNC_FROM = date(2026, 3, 1)  # whole 2026 season, so load baselines and back-tests have history
API_SYNC_EVERY_MINUTES = 15     # how often the app checks Catapult for new sessions
BACKGROUND_PULL_HOURS = (7, 23)  # background job only pulls between these hours (local time)
BACKGROUND_PULL_OFF_DAY_HOURS = 3  # on days with nothing in the calendar, pull this often (catches games, re-uploads)
TOKEN_WARN_DAYS = 35            # warn this long before the API token expires (covers the Dec–Jan break)
TIMEZONE = "Australia/Melbourne"

# GPS data quality
MAX_PLAUSIBLE_KMH = 40.0        # anything faster is a GPS spike
SPIKE_OVER_MAX = 1.10           # >110% of a player's max is treated as a spike, not a new max
OPENFIELD_PLACEHOLDER_KMH = 36.0  # OpenField's value when no max has been set
NO_GPS_KMH = 10.0               # a unit whose top speed is below this never got a GPS lock (or sat in a bag)
MAX_GAME_MINUTES = 150          # longer than any game: a unit left running, so the session is faulty

# Team-wide speed bands (km/h)
HSR_KMH = 19.8
SPRINT_KMH = 25.2               # 7 m/s. OpenField CSV exports (player cards, profiles) still use 25 km/h

# Running prescription
COD_COST = 0.7                  # metres lost per change of direction, per m/s of MAS
MAS_GROUPS = [5.2, 5.0, 4.8, 4.6, 4.4]  # m/s, from the HIIT sheets
TIME_AT_VO2MAX_FRACTION = 0.35  # rough estimate used in the conditioning workbook
