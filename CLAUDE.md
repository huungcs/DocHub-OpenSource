# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                 # Build then serve dist/ at http://localhost:3000
npm run build               # Generate dist/index.html and root index.html from source
npm test                    # Unit, cloud, and auth tests
npm run test:unit           # All unit tests
npm run test:cloud          # Cloud integration/offline tests
npm run test:auth           # Auth bridge test
node --test tests/unit/organization-api.test.js  # Run one test file
npm run check               # Full test suite followed by a build
npm run db:migrate          # Apply database/migrations in numeric order
```

`server.js` only serves generated files from `dist`; use `npm run dev` for local development. `npm run db:migrate` needs `SUPABASE_DB_PASSWORD` (or `APP_PASSWORD`) and reads `.env` if present.

## Architecture

DocHub is a browser-first document-management application with Supabase authentication/PostgreSQL authorization and Google Drive file storage. The build starts at `src/app/index.template.html`; it is intentionally a monolithic application shell that holds UI state and client-side workflows. Do not edit `dist/index.html` directly: `scripts/build.js` regenerates it and copies the result to the root `index.html`.

The browser app keeps workspace state in memory and local storage, then delegates cloud behaviors through `window.DocHubAPI`. `src/integrations/supabase/cloud-bridge.js` owns Supabase sessions, organization selection, workspace synchronization, server-backed assets, and upload orchestration. `src/integrations/google-drive/client.js` is the direct Drive integration used for the non-server-backed path. `src/integrations/google-drive/stream-worker.js` provides same-origin range streaming for media.

The production organization path uses `api/organization.js` as the Vercel entry and `src/server/organization-api.js` for the API implementation. It authenticates Supabase bearer tokens, checks folder permissions through PostgreSQL RPCs, and accesses the organization-owned Drive connection server-side. Uploads use resumable Drive sessions stored in `organization_uploads`, then index successful files in `documents_index`.

Database migrations are ordered and immutable in `database/migrations`. The authorization model is centered on `organizations`, `organization_members`, `organization_folders`, `folder_acl_entries`, and the `dochub_can_folder_action`/`dochub_effective_folder_role` functions. The browser can render permissions, but Postgres RLS and server API checks are the authority. Later migrations can replace functions and policies defined earlier, so inspect the latest relevant migration before changing database behavior.

## Testing focus

Tests are Node-native (`node:test`) and inspect both behavioral logic and source-level invariants. `tests/unit/organization-api.test.js` exercises the server API with mocked upstreams; extend it for API authorization, upload, and Drive workflows. `tests/unit/auth/cloud-bridge.test.js` loads the browser bridge in a VM. The source template is tested directly, so preserve its public hooks (`window.DocHubAPI`, `window.DocHubMedia`, `window.DocHubDemo`, and `window.DocHubMobileBridge`) when refactoring.
