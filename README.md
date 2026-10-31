# YourAnimeList

A fast, compact and data-first way to explore a MyAnimeList account.

YourAnimeList combines a user's list with a local MyAnimeList database. It is made for completionists who want to inspect what they have watched, find what they are missing and understand the franchises behind each entry without unnecessary clutter.

The project includes the anime list, missing entries, detailed statistics, database search, franchise completion and recommendations.

## Development

Install the dependencies:

```bash
pnpm install
```

Copy `apps/api/.env.example` to `apps/api/.env`, add a MyAnimeList client ID and point `SQLITE_PATH` to the local database. Then start the frontend and API together:

```bash
pnpm dev
```

The website runs at `http://localhost:5173` and the API at `http://localhost:3001`.

## Build

```bash
pnpm build
```

The static website is generated in `apps/web/build` and the compiled API in `apps/api/dist`.

## Deployment

The frontend is deployed on Netlify. Import the repository and leave the base directory empty; `netlify.toml` contains the build command, output directory and public API URL.

The API is deployed separately on the Raspberry Pi:

```bash
cd apps/api
docker compose up -d --build
```

Set `MAL_CLIENT_ID` and `SQLITE_HOST_DIR` in `apps/api/.env`. The API mounts the database directory read-only.

The production Compose file also runs the catalog crawler. Set `SQLITE_HOST_DIR` to the directory containing `mal_anime.sqlite`; the API mounts it read-only while the crawler maintains a separate working copy. Each weekly pass:

- refreshes every known anime sequentially with a random 1–3 second delay;
- rechecks one quarter of historical 404s;
- discovers new sequential IDs until 1,000 consecutive misses;
- validates and atomically publishes the completed SQLite snapshot;
- keeps the previous snapshot as `mal_anime.sqlite.previous`.

The crawler resumes an interrupted working copy and never publishes a partial pass. Live metrics and the latest 100 sanitized log lines are available on the subtle `/maintenance` page.

Caddy only needs to proxy the API domain to the container:

```caddy
api-anime.diegogliarte.com {
    encode zstd gzip
    reverse_proxy youranimelist-api:3001
}
```

## Notes

- The frontend and API live in the same repository but are built and deployed independently.
- User preferences and recent data are cached in the browser.
- Public API responses include cache headers for proxy and browser caching.
