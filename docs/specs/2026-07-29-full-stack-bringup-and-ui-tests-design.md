# Full-stack one-command bring-up + UI automated tests

Date: 2026-07-29
Status: Approved (design)

## Problem

Two gaps after the UI authentication work (PR #35) merged:

1. There is no single command that brings up the **entire** stack — Postgres,
   the modern GL core, the bank API, **and** the new Next.js UI — wired together.
   Existing scripts stop short: `scripts/start-nano-bank.sh` runs Postgres (kind)
   + API (`cargo run`) with no core and no UI; `scripts/deploy-all.sh` deploys the
   modern core (cluster B) + bank/agent (cluster A) but not the UI.
2. The UI has **no automated tests** (the README calls this out).

## Goals

- `./scripts/deploy-all.sh` stands up the whole stack in kind, including the UI,
  reachable at `http://localhost:3000`.
- Add two test layers for the UI: fast unit tests (no infra) and an end-to-end
  browser suite against the live stack.

## Non-goals

- No production hardening (TLS, ingress, autoscaling, image registries).
- No changes to the auth behaviour merged in PR #35 beyond a small, test-driven
  refactor (extracting one pure helper).
- No new backend features.

## Architecture

All in kind, matching the existing k8s-migration layout (two isolated clusters):

```
browser
  → http://localhost:3000
    → kind node :30300 (NodePort)
      → nano-bank-ui pod :3000  (Next.js server)
        → server-side fetch → bank-api:8081  (in-cluster DNS, cluster A)
                                 ├── Postgres (postgres-service:5432, cluster A)
                                 └── modern-core:8091 → host gateway → cluster B
```

Key property that keeps this simple: **every API call the UI makes is
server-side** — the sign-in/up/out server actions and the `/api/auth/refresh`
Route Handler all `fetch` from the Node server, never the browser. So the browser
only ever talks to the UI; the UI pod reaches `bank-api` by cluster DNS
(`http://bank-api:8081`), and only the UI needs to be exposed to the host.

### Component 1 — UI container image

- `ui/Dockerfile`: multi-stage on `node:20`.
  - build stage: `npm ci`, `npm run build` (Next 16 standalone output).
  - runtime stage: `node:20-slim`, copy `.next/standalone`, `.next/static`,
    `public`; run `node server.js` on port 3000.
- `ui/next.config.ts`: add `output: "standalone"` for a slim runtime image.
- The in-cluster API URL is provided at build time:
  `ARG NEXT_PUBLIC_API_BASE_URL=http://bank-api:8081` → `ENV`. `NEXT_PUBLIC_*`
  values are inlined by Next at build; the deploy script rebuilds the image each
  run, so baking the cluster-internal URL is acceptable. `config.ts` already
  reads `process.env.NEXT_PUBLIC_API_BASE_URL` with a `http://localhost:8081`
  fallback, so no app code change is needed here.

### Component 2 — UI k8s manifests

- `k8s/ui-deployment.yaml`:
  - `Deployment nano-bank-ui` in namespace `nano-bank`, image `nano-bank-ui:dev`,
    `imagePullPolicy: Never`, `containerPort: 3000`, readiness probe `GET /`.
  - `Service nano-bank-ui` type **NodePort**, `port: 3000`, `nodePort: 30300`.

### Component 3 — cluster port mapping

- `k8s/kind-cluster-config.yaml`: add one `extraPortMapping`
  `{ containerPort: 30300, hostPort: 3000, protocol: TCP }` alongside the
  existing 80/443/5432. kind fixes port mappings at cluster-creation time, so a
  cluster created before this change lacks the mapping.

### Component 4 — deploy script changes

- `k8s/deploy.sh` (runs against cluster A):
  - **Cluster recreation guard:** if cluster `nano-bank` exists but does not
    publish host port 3000, delete and recreate it from the updated config
    (print a clear warning: Postgres data is wiped and re-initialised by the
    existing `init-db` job). If it does not exist, create from config. If it
    already has the mapping, leave it.
  - After `bank-api` is rolled out: `docker build -t nano-bank-ui:dev ../ui` →
    `kind load docker-image nano-bank-ui:dev --name nano-bank` →
    `kubectl apply -f k8s/ui-deployment.yaml` →
    `kubectl -n nano-bank rollout status deploy/nano-bank-ui`.
  - Final output prints `UI: http://localhost:3000`.
- `scripts/deploy-all.sh`: unchanged in shape (cluster B core, then cluster A).
  Because cluster A's `deploy.sh` now also stands up the UI,
  `./scripts/deploy-all.sh` is the single "everything up" command.

## Testing

### Unit tests — vitest (no infra)

- Add `vitest` (+ `@vitest/coverage` optional) as devDependencies; `vitest.config.ts`.
- `npm` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Cases:
  - `decodeJwtExpiry` (`ui/src/lib/jwt.ts`): valid token → `exp`; malformed
    payload → `null`; missing/non-numeric `exp` → `null`.
  - `friendlyErrorMessage`: mapped code → friendly copy; unmapped-but-safe code
    → passes API message through; missing message → fallback. `ERROR_CODE_COPY` +
    `friendlyErrorMessage` (and the `ApiErrorBody` type) are **extracted** from
    the `"use server"` module `ui/src/actions/auth.ts` into a pure
    `ui/src/lib/errors.ts`; `auth.ts` re-imports them. This is required so the
    test does not import a `server-only` module.
  - `sanitizeNextPath` (`ui/src/lib/redirects.ts`, **new** — extracted from the
    inline guard in `app/api/auth/refresh/route.ts`): `"/dashboard"` → allowed;
    `"//evil.com"`, `"https://evil.com"`, `""`, `null` → `"/dashboard"`. The
    route imports this helper (behaviour unchanged, now unit-tested).

### End-to-end tests — Playwright (live stack)

- Add `@playwright/test`; `playwright.config.ts` with
  `use.baseURL: "http://localhost:3000"`, no auto web-server (stack is external).
- `ui/e2e/auth.spec.ts`:
  - **Happy path:** home → signup (unique `test+<ts>@example.com`, an API-valid
    SIN and a DOB) → signin → `/dashboard` shows "Welcome back" → assert cookies
    (`access_token` short max-age, `refresh_token` ~7 days) → logout → `/auth/signin`.
  - **Silent refresh (guards the PR #35 fix):** after signin, delete only the
    `access_token` cookie, reload `/dashboard`, assert still on `/dashboard`
    (exercises the `/api/auth/refresh` Route Handler rather than crashing).
- `scripts/e2e-ui.sh` (**new**): verify stack up (`curl -fsS localhost:3000`),
  then `cd ui && npx playwright test`. Mirrors `agent/e2e_test.sh`.

### SIN validation

`POST /api/v1/customers` may validate the SIN (format/Luhn). The plan step that
writes the signup test will first read the API's customer-creation validation and
use a conforming test value, rather than a random string.

## Verification reality

- The vitest unit tests can be run in the dev environment (Node 20).
- The full k8s e2e requires Docker + kind + both clusters + Playwright browsers,
  which may not be fully runnable in the authoring session. The Playwright suite
  will be written and self-checked; the green e2e run may be the user's to
  execute. The delivery will state explicitly what was run vs. not.

## Risks / trade-offs

- **Cluster recreation** wipes Postgres data. Accepted: this is a dev stack and
  the schema re-initialises automatically; the script warns before doing it.
- **Build-time API URL** bakes `http://bank-api:8081` into the image. Fine for
  the in-cluster dev deploy; a future change could switch `config.ts` to a
  runtime (non-`NEXT_PUBLIC`) server var if a rebuild-free URL is ever needed.
