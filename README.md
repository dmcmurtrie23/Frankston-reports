# Catapult Activity & Athlete Reporting Dashboard

A React (Vite) + FastAPI app, built the same way as your other Catapult
tools: a Python backend that talks to Catapult Connect v6, and a small
React frontend that talks to your backend. Runs locally for now; the
backend is a normal FastAPI app and the frontend builds to static files,
so it can be hosted anywhere later.

## What it does

1. Enter your OpenField **token**, **region**, and a **start/end date**
   in the sidebar, then hit **Fetch Data**. This makes two calls to
   Catapult: `GET /activities` for the activity list, and one
   `POST /stats` (grouped by activity/athlete/period/position/team) for
   the whole date range — matching the two calls in your original R
   script, just done once for the full range instead of per-activity.
2. Use the **Date → Activity** pickers along the top to choose which
   single activity the Reporting tab looks at.
3. **Reporting tab**
   - Top table: averages of each numeric parameter, grouped by **period**.
   - Bottom table: totals of each numeric parameter, grouped by
     **athlete**, for the selected activity.
4. **Averages tab** — two sub-tabs, **Training Average** and **Match
   Average**, each independent:
   - Click **tag** buttons to filter which activities are shown (tags
     come straight from each activity's `tags` field — nothing about
     "training" vs "match" is hard-coded, it's just two separate filter
     panels so you can save two different tag/activity/period
     combinations at once).
   - Pick which **activities** (from the filtered set) go into the
     average.
   - Pick which **periods** (only ones present in your selected
     activities) go into the average.
   - **Calculate Average** groups by athlete and averages every numeric
     parameter across exactly the rows you selected.

## Startup defaults (app-config.txt)

`app-config.txt`, right here at the project root next to this README, is
a plain text file (not code) that sets what the app opens with:

- default start/end date (leave blank for "today")
- default Training Average tag and periods (leave blank for "all
  activities" / "all periods")
- default Match Average tag and periods (same)

Open it in any text editor, change the values after the colons, save, and
refresh the browser tab — no rebuild needed. The backend reads it fresh
from disk on every request. The file itself has full instructions in its
comments.

## A note on column names

Catapult's `/stats` response field names can vary slightly by account/
region (e.g. `activity_id` vs `activity`). `backend/app/catapult_client.py`
normalizes whichever name it finds to a canonical one, using the
candidate lists in `backend/app/config.py`. If a table looks empty or
wrong after your first real fetch:

```
GET http://localhost:8000/api/debug/last-fetch
```

This shows the raw column names Catapult actually returned for your
account. Add whatever you see there to the relevant list in
`config.py` (`STATS_COLUMN_CANDIDATES` / `ACTIVITY_COLUMN_CANDIDATES`)
and restart the backend.

## Project layout

```
app-config.txt      startup defaults (dates, tags, periods) — plain text, edit anytime

backend/            FastAPI app
  app/
    main.py          routes: /api/fetch-data, /api/app-config, /api/debug/last-fetch
    catapult_client.py   real Catapult Connect v6 calls -> DataFrames
    config.py             regions, parameters, column-name candidates
    schemas.py             pydantic request/response models
  requirements.txt

frontend/            React (Vite) app
  src/
    App.jsx
    api.js
    utils/
      aggregate.js       group-by/average/sum helpers
      appConfig.js       parses app-config.txt's contents (fetched via the backend)
    components/
      Sidebar.jsx            token/region/date-range, Fetch Data
      TopBar.jsx             Date -> Activity pickers
      ReportingTab.jsx        period-average table + athlete-total table
      AveragesTab.jsx         Training / Match sub-tabs
      AverageBuilder.jsx      tag filter -> activity picker -> period picker -> average table
      PlayerHighlightsTab.jsx  who's above their average, sortable lists
      DataTable.jsx           generic sortable table renderer
```

## Running it locally

### First time

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

### Every time after that

```bash
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000
```
```bash
cd frontend && npm run dev
```

`npm run dev` opens your browser automatically at `http://localhost:5173`.
It talks to the backend at `http://localhost:8000` by default — override
with a `VITE_API_URL` env var if you ever deploy them separately.

## Taking it online later

- The backend is a standard FastAPI app — deploy it anywhere that runs
  Python, behind HTTPS.
- The frontend is a standard Vite/React app — `npm run build` produces a
  static `dist/` folder you can host anywhere, pointed at your deployed
  backend via `VITE_API_URL`.
- The token is only ever held in the browser tab and sent straight to
  your own backend, which forwards it to Catapult over HTTPS. Nothing is
  persisted server-side except the last fetch's raw column names (for the
  debug endpoint), which reset on backend restart.
