# Setting up the visitor-tracker Worker

## 1. Create the KV namespace (one-time)
From inside `phobiafree-rebuild`:
```
wrangler kv namespace create VISITORS_KV
```
This prints a `kv_namespaces` snippet similar to what `d1 create` gave you — copy the `id` it gives you.

## 2. Update wrangler.toml
Add the KV binding to the same `wrangler.toml` you already created. It should now look like:
```toml
name = "phobiafree-rebuild"
compatibility_date = "2026-06-26"
main = "visitor-tracker-worker.js"

[[d1_databases]]
binding = "phobiafree_db"
database_name = "phobiafree-db"
database_id = "d535cc2f-b269-4b2e-b366-85dcaca0bf8b"

[[kv_namespaces]]
binding = "VISITORS_KV"
id = "PASTE_THE_ID_FROM_STEP_1_HERE"
```

## 3. Run it locally
```
wrangler dev
```
This starts the Worker on your machine (something like `http://localhost:8787`), using your local D1 + KV (the same local D1 data you already seeded with schema.sql).

## 4. Test it
With `wrangler dev` running, in a separate PowerShell window:
```
curl -X POST http://localhost:8787/track -H "Content-Type: application/json" -d "{\"vid\":\"testvid123\",\"x\":100,\"y\":200,\"vw\":1200,\"vh\":800,\"page\":\"home\",\"device\":\"desktop\"}"
```
Run it twice (pings need to be >= 2 to count as a "real" visitor and get logged to D1). Then check:
```
curl http://localhost:8787/track
```
You should see `testvid123` in the response.

## 5. Frontend changes needed
The old tracker script (`welcome.js` / `visitor_tracker.html`) posts to `cursor_track.php`. Update the fetch URL to point at this Worker's `/track` route instead — once deployed, that'll be something like `https://phobiafree-rebuild.<your-subdomain>.workers.dev/track`, or a custom route if you set one up later.

One behavior change to note: the old `?event=1` ping used form-encoded POST data. This Worker accepts that too, but if you have control over the frontend, sending JSON there as well (matching the regular ping format) will simplify things — your call whether to change it now or leave it as-is since both are supported.
