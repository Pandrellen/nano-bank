# Full-stack one-command bring-up + UI automated tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `./scripts/deploy-all.sh` bring up the entire stack (Postgres + modern core + bank API + Next.js UI) in kind, reachable at `http://localhost:3000`, and add unit (vitest) + e2e (Playwright) tests for the UI.

**Architecture:** The UI runs as an in-cluster Deployment in cluster A (`nano-bank` namespace) exposed via a NodePort (30300) mapped to host port 3000. All UI→API calls are server-side, so the UI pod reaches `bank-api:8081` by cluster DNS and only the UI needs host exposure. Tests are two layers: fast pure-logic vitest units, and a Playwright browser suite against the live stack.

**Tech Stack:** Next.js 16 (standalone output), Node 20, Docker, kind, kubectl, vitest, Playwright.

## Global Constraints

- UI build/test require **Node ≥ 20.9.0** (Next 16). In this dev environment use the portable Node 20 already at `/tmp/claude-1000/-home-bmartins-dev/e46283aa-1c01-465c-9c4f-fec9c705c539/scratchpad/node20/bin` (prepend to `PATH`), or the user's own Node 20.
- All k8s work targets cluster **`nano-bank`** (context `kind-nano-bank`), namespace **`nano-bank`**.
- Images are built locally and loaded into kind: tag **`nano-bank-ui:dev`**, `imagePullPolicy: Never`, `kind load docker-image ... --name nano-bank`. Mirror `nano-bank-api:dev`.
- UI host exposure: Service NodePort **30300** ↔ kind hostPort **3000**.
- In-cluster API URL for the UI: **`http://bank-api:8081`**.
- Do **not** change the auth behaviour merged in PR #35 except the two pure extractions in Task 1 (behaviour must stay identical).
- Test SIN value: **`"123456789"`** (API validates SIN as exactly 9 chars, no Luhn). DOB format `YYYY-MM-DD`. Phone 10–20 digits. Password ≥ 8 chars.
- Work happens on branch `ui-fullstack-and-tests` (already created off `main`).

---

### Task 1: Pure helpers + vitest unit tests

Extract two pure helpers out of server-only modules so they can be unit-tested, wire vitest, and cover `decodeJwtExpiry`, `friendlyErrorMessage`, and `sanitizeNextPath`. Behaviour of the app is unchanged.

**Files:**
- Create: `ui/src/lib/errors.ts`
- Create: `ui/src/lib/redirects.ts`
- Create: `ui/vitest.config.ts`
- Create: `ui/test/server-only-stub.ts`
- Create: `ui/src/lib/redirects.test.ts`
- Create: `ui/src/lib/errors.test.ts`
- Create: `ui/src/lib/jwt.test.ts`
- Modify: `ui/src/actions/auth.ts` (move error helpers out, import them)
- Modify: `ui/src/app/api/auth/refresh/route.ts` (use `sanitizeNextPath`)
- Modify: `ui/package.json` (devDeps + `test` scripts)

**Interfaces:**
- Produces `ui/src/lib/errors.ts`:
  - `interface ApiErrorBody { error: { code: string; message: string; details: string } }`
  - `const ERROR_CODE_COPY: Record<string, string>`
  - `function friendlyErrorMessage(errorBody: ApiErrorBody, fallback: string): string`
- Produces `ui/src/lib/redirects.ts`:
  - `function sanitizeNextPath(input: string | null | undefined, fallback?: string): string`
- Consumes existing `ui/src/lib/jwt.ts` → `decodeJwtExpiry(token: string): number | null`.

- [ ] **Step 1: Install vitest (devDependency)**

Run (with Node 20 on PATH):
```bash
cd ui && npm install -D vitest@^2
```

- [ ] **Step 2: Add test scripts to `ui/package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create the server-only stub and vitest config**

`ui/test/server-only-stub.ts`:
```ts
// Vitest stub for the `server-only` package, which throws when imported outside
// a server bundle. Aliased in vitest.config.ts so server modules (e.g. jwt.ts)
// can be unit-tested in a plain Node context.
export {};
```

`ui/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: Write the failing tests**

`ui/src/lib/redirects.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "@/lib/redirects";

describe("sanitizeNextPath", () => {
  it("allows an internal absolute path", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/accounts/123")).toBe("/accounts/123");
  });
  it("rejects protocol-relative and absolute URLs", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
  });
  it("falls back on empty / missing input", () => {
    expect(sanitizeNextPath("")).toBe("/dashboard");
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
  });
  it("honours a custom fallback", () => {
    expect(sanitizeNextPath("//x", "/home")).toBe("/home");
  });
});
```

`ui/src/lib/errors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { friendlyErrorMessage, type ApiErrorBody } from "@/lib/errors";

const body = (code: string, message = "raw"): ApiErrorBody => ({
  error: { code, message, details: "" },
});

describe("friendlyErrorMessage", () => {
  it("maps known developer-facing codes to safe copy", () => {
    expect(friendlyErrorMessage(body("VALIDATION_ERROR"), "fb")).toBe(
      "Please check the information you entered and try again.",
    );
  });
  it("passes through the API message for safe codes", () => {
    expect(friendlyErrorMessage(body("AUTH_ERROR", "Invalid credentials"), "fb")).toBe(
      "Invalid credentials",
    );
  });
  it("uses the fallback when no message is present", () => {
    const noMessage = { error: { code: "UNKNOWN" } } as unknown as ApiErrorBody;
    expect(friendlyErrorMessage(noMessage, "fb")).toBe("fb");
  });
});
```

`ui/src/lib/jwt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decodeJwtExpiry } from "@/lib/jwt";

function makeToken(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${b64}.sig`;
}

describe("decodeJwtExpiry", () => {
  it("reads a numeric exp claim", () => {
    expect(decodeJwtExpiry(makeToken({ exp: 1_700_000_000 }))).toBe(1_700_000_000);
  });
  it("returns null when exp is missing or non-numeric", () => {
    expect(decodeJwtExpiry(makeToken({ foo: 1 }))).toBeNull();
    expect(decodeJwtExpiry(makeToken({ exp: "soon" }))).toBeNull();
  });
  it("returns null for a malformed token", () => {
    expect(decodeJwtExpiry("only-one-part")).toBeNull();
    expect(decodeJwtExpiry("a.!!!.c")).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd ui && npm test`
Expected: FAIL — `@/lib/redirects` and `@/lib/errors` do not exist yet.

- [ ] **Step 6: Create `ui/src/lib/redirects.ts`**

```ts
/** Restricts a post-refresh redirect target to same-origin relative paths, so a
 * crafted `?next=` cannot bounce the user to an external site. */
export function sanitizeNextPath(input: string | null | undefined, fallback = "/dashboard"): string {
  if (!input) return fallback;
  return input.startsWith("/") && !input.startsWith("//") ? input : fallback;
}
```

- [ ] **Step 7: Create `ui/src/lib/errors.ts` (moved verbatim from auth.ts)**

```ts
/** Mirrors the API's `{ "error": { "code", "message", "details" } }` envelope
 * (see api/src/errors/mod.rs — every AppError variant serializes to this shape). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: string;
  };
}

/** Own copy for API error codes whose `message` can be developer/DB-facing
 * (e.g. handlers/customers.rs formats a raw Postgres check-violation message
 * straight into a BAD_REQUEST). Codes not listed here (CONFLICT, AUTH_ERROR,
 * RATE_LIMIT, ...) already carry a message that's safe to show verbatim, so
 * they fall through to it. */
export const ERROR_CODE_COPY: Record<string, string> = {
  VALIDATION_ERROR: "Please check the information you entered and try again.",
  BAD_REQUEST: "We couldn't process those details. Please double-check your information and try again.",
  DATABASE_ERROR: "Something went wrong on our end. Please try again in a moment.",
  INTERNAL_ERROR: "Something went wrong on our end. Please try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Please try again shortly.",
};

export function friendlyErrorMessage(errorBody: ApiErrorBody, fallback: string): string {
  const { code, message } = errorBody.error;
  return ERROR_CODE_COPY[code] ?? message ?? fallback;
}
```

- [ ] **Step 8: Update `ui/src/actions/auth.ts` to import the helpers**

Remove the `ApiErrorBody` interface, `ERROR_CODE_COPY`, and `friendlyErrorMessage` definitions (lines defining them, ~9–35). Add to the import block near the top:
```ts
import { friendlyErrorMessage, type ApiErrorBody } from "@/lib/errors";
```
Leave every other line (signUp/signIn/refresh/logout, `setSessionCookies`) unchanged.

- [ ] **Step 9: Update the refresh route to use `sanitizeNextPath`**

In `ui/src/app/api/auth/refresh/route.ts`, add the import:
```ts
import { sanitizeNextPath } from "@/lib/redirects";
```
Replace the two lines that compute `next`:
```ts
  const requested = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
```
with:
```ts
  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd ui && npm test`
Expected: PASS (all three files, 10 assertions).

- [ ] **Step 11: Verify the app still type-checks/builds**

Run: `cd ui && npm run build`
Expected: "Compiled successfully", TypeScript passes.

- [ ] **Step 12: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/vitest.config.ts ui/test ui/src/lib ui/src/actions/auth.ts ui/src/app/api/auth/refresh/route.ts
git commit -m "test(ui): add vitest unit tests; extract pure error + redirect helpers"
```

---

### Task 2: UI container image (standalone)

Produce a slim runtime image that runs the Next.js server on :3000.

**Files:**
- Modify: `ui/next.config.ts` (add `output: "standalone"`)
- Create: `ui/Dockerfile`
- Create: `ui/.dockerignore`

**Interfaces:**
- Produces image `nano-bank-ui:dev` running `node server.js` on port 3000, with `NEXT_PUBLIC_API_BASE_URL` baked at build (default `http://bank-api:8081`).

- [ ] **Step 1: Enable standalone output**

In `ui/next.config.ts` set the config object to:
```ts
const nextConfig: NextConfig = {
  output: "standalone",
};
```

- [ ] **Step 2: Verify standalone build produces a server**

Run: `cd ui && npm run build && test -f .next/standalone/server.js && echo STANDALONE_OK`
Expected: prints `STANDALONE_OK`.

- [ ] **Step 3: Create `ui/.dockerignore`**

```
node_modules
.next
.git
npm-debug.log
Dockerfile
.dockerignore
e2e
playwright-report
test-results
```

- [ ] **Step 4: Create `ui/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=http://bank-api:8081
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```
Note: `ui/public` exists (create-next-app scaffolds it); confirm with `ls ui/public` before building. If it is absent, remove the `public` COPY line.

- [ ] **Step 5: Build the image**

Run: `docker build -t nano-bank-ui:dev ui`
Expected: builds successfully; `docker image inspect nano-bank-ui:dev >/dev/null && echo IMAGE_OK`.

- [ ] **Step 6: Commit**

```bash
git add ui/next.config.ts ui/Dockerfile ui/.dockerignore
git commit -m "build(ui): standalone Dockerfile for in-cluster deployment"
```

---

### Task 3: kind port mapping + UI k8s manifests

**Files:**
- Modify: `k8s/kind-cluster-config.yaml` (add hostPort 3000 mapping)
- Create: `k8s/ui-deployment.yaml`

**Interfaces:**
- Produces Deployment/Service `nano-bank-ui` in namespace `nano-bank`; Service is NodePort 30300 → pod 3000.

- [ ] **Step 1: Add the UI port mapping to the kind config**

In `k8s/kind-cluster-config.yaml`, under the control-plane node's `extraPortMappings`, append (keep the existing 80/443/5432 entries):
```yaml
  - containerPort: 30300
    hostPort: 3000
    protocol: TCP
```

- [ ] **Step 2: Create `k8s/ui-deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nano-bank-ui
  namespace: nano-bank
  labels: { app: nano-bank-ui }
spec:
  replicas: 1
  selector:
    matchLabels: { app: nano-bank-ui }
  template:
    metadata:
      labels: { app: nano-bank-ui }
    spec:
      containers:
      - name: nano-bank-ui
        image: nano-bank-ui:dev
        imagePullPolicy: Never
        ports:
        - containerPort: 3000
        readinessProbe:
          httpGet: { path: /, port: 3000 }
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: nano-bank-ui
  namespace: nano-bank
spec:
  type: NodePort
  selector: { app: nano-bank-ui }
  ports:
  - port: 3000
    targetPort: 3000
    nodePort: 30300
```

- [ ] **Step 3: Validate the manifest**

Run: `kubectl apply --dry-run=client -f k8s/ui-deployment.yaml`
Expected: `deployment.apps/nano-bank-ui created (dry run)` and `service/nano-bank-ui created (dry run)` with no errors.

- [ ] **Step 4: Commit**

```bash
git add k8s/kind-cluster-config.yaml k8s/ui-deployment.yaml
git commit -m "feat(k8s): UI deployment + NodePort 30300 mapped to host 3000"
```

---

### Task 4: Wire the UI into the deploy scripts

Make `k8s/deploy.sh` ensure cluster A exists with the UI port mapping and stand up the UI after `bank-api`, so `./scripts/deploy-all.sh` is the single "everything up" command.

**Files:**
- Modify: `k8s/deploy.sh`
- Modify: `scripts/deploy-all.sh`

**Interfaces:**
- Consumes: `k8s/ui-deployment.yaml`, `nano-bank-ui:dev` image (Tasks 2–3).

- [ ] **Step 1: Add a cluster-ensure/recreate guard at the top of `k8s/deploy.sh`**

Immediately after `cd "$(dirname "$0")"` (before the `kubectl cluster-info` check), insert:
```bash
# Ensure cluster A exists AND publishes host port 3000 (needed for the UI).
# kind fixes port mappings at creation time, so a cluster made before the UI
# mapping was added must be recreated (Postgres data is wiped; the init-db job
# below re-creates the schema).
if kind get clusters 2>/dev/null | grep -qx "nano-bank"; then
  if ! docker port nano-bank-control-plane 2>/dev/null | grep -q '3000'; then
    echo "⚠️  Existing 'nano-bank' cluster lacks the UI port 3000 mapping."
    echo "    Recreating it — Postgres data will be wiped and the schema re-initialised."
    kind delete cluster --name nano-bank
    kind create cluster --config kind-cluster-config.yaml
  fi
else
  echo "📦 Creating 'nano-bank' cluster..."
  kind create cluster --config kind-cluster-config.yaml
fi
kubectl config use-context kind-nano-bank >/dev/null
```

- [ ] **Step 2: Add UI build/load/deploy after the bank-api rollout**

In `k8s/deploy.sh`, after the line `kubectl -n nano-bank rollout status deploy/bank-api --timeout=180s`, insert:
```bash
echo "🐳 Building + loading nano-bank-ui image..."
docker build -t nano-bank-ui:dev ../ui
kind load docker-image nano-bank-ui:dev --name nano-bank

echo "🖥️  Deploying nano-bank-ui..."
kubectl apply -f k8s/ui-deployment.yaml
kubectl -n nano-bank rollout status deploy/nano-bank-ui --timeout=180s
```

- [ ] **Step 3: Print the UI URL in the final summary**

In `k8s/deploy.sh`, in the closing `echo` summary block, add a line after the API/DB details:
```bash
echo "  UI:                http://localhost:3000"
```

- [ ] **Step 4: Update `scripts/deploy-all.sh`'s final message**

Replace the final `echo "✅ full stack up — run: ./agent/e2e_test.sh"` line with:
```bash
echo "✅ full stack up"
echo "   UI:  http://localhost:3000"
echo "   API: http://localhost:8081 (in-cluster)"
echo "   Backend e2e: ./agent/e2e_test.sh    UI e2e: ./scripts/e2e-ui.sh"
```

- [ ] **Step 5: Syntax-check both scripts**

Run: `bash -n k8s/deploy.sh && bash -n scripts/deploy-all.sh && echo SCRIPTS_OK`
Expected: prints `SCRIPTS_OK`. If `shellcheck` is available, also run `shellcheck k8s/deploy.sh scripts/deploy-all.sh` and address errors (warnings optional).

- [ ] **Step 6: Commit**

```bash
git add k8s/deploy.sh scripts/deploy-all.sh
git commit -m "feat(deploy): bring up the UI in-cluster from deploy-all.sh"
```

---

### Task 5: Playwright e2e suite + runner script

**Files:**
- Create: `ui/playwright.config.ts`
- Create: `ui/e2e/auth.spec.ts`
- Create: `scripts/e2e-ui.sh`
- Modify: `ui/package.json` (Playwright devDep + `test:e2e` script)
- Modify: `ui/.gitignore` (ignore Playwright artifacts)

**Interfaces:**
- Consumes the running stack at `http://localhost:3000` (Tasks 2–4).

- [ ] **Step 1: Install Playwright**

Run: `cd ui && npm install -D @playwright/test@^1 && npx playwright install chromium`

- [ ] **Step 2: Add the `test:e2e` script to `ui/package.json`**

```json
    "test:e2e": "playwright test"
```

- [ ] **Step 3: Ignore Playwright artifacts**

Append to `ui/.gitignore`:
```
/test-results
/playwright-report
/blob-report
/playwright/.cache
```

- [ ] **Step 4: Create `ui/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.UI_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 5: Confirm the sign-up / sign-in form fields**

Read `ui/src/app/auth/signup/SignupForm.tsx` and `ui/src/app/auth/signin/SigninForm.tsx` and note each input's accessible name (associated `<label>`, `aria-label`, `name`, or `placeholder`). Use the matching Playwright locator in Step 6 (the spec below uses `getByLabel` with case-insensitive regex; if the form uses placeholders instead of labels, switch those locators to `getByPlaceholder`).

- [ ] **Step 6: Write `ui/e2e/auth.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

function uniqueEmail() {
  return `e2e+${Date.now()}@example.com`;
}

const PASSWORD = "password123";

async function signUp(page, email: string) {
  await page.goto("/auth/signup");
  await page.getByLabel(/first name/i).fill("Test");
  await page.getByLabel(/last name/i).fill("User");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/phone/i).fill("5551234567");
  await page.getByLabel(/date of birth/i).fill("1990-01-01");
  await page.getByLabel(/sin/i).fill("123456789");
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign up|create/i }).click();
}

async function signIn(page, email: string) {
  await page.goto("/auth/signin");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL("**/dashboard");
}

test("sign up, sign in, reach dashboard, log out", async ({ page }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await signIn(page, email);

  await expect(page.getByText(/welcome back/i)).toBeVisible();

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForURL("**/auth/signin");
});

test("access-token cookie is short-lived; refresh cookie is long-lived", async ({ page, context }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await signIn(page, email);

  const cookies = await context.cookies();
  const access = cookies.find((c) => c.name === "access_token");
  const refresh = cookies.find((c) => c.name === "refresh_token");
  expect(access, "access_token cookie present").toBeTruthy();
  expect(refresh, "refresh_token cookie present").toBeTruthy();
  // access token must expire far sooner than the refresh token (fix from PR #35).
  expect(refresh!.expires - access!.expires).toBeGreaterThan(3 * 24 * 60 * 60);
});

test("silent refresh: expired access cookie is rotated, not a crash", async ({ page, context }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await signIn(page, email);

  // Simulate an expired/absent access token while the refresh token is still valid.
  await context.clearCookies({ name: "access_token" });

  await page.goto("/dashboard");
  // Should land back on the dashboard (via /api/auth/refresh), not the error page.
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(/welcome back/i)).toBeVisible();
  const access = (await context.cookies()).find((c) => c.name === "access_token");
  expect(access, "a fresh access_token was set").toBeTruthy();
});
```

- [ ] **Step 7: Create `scripts/e2e-ui.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

UI_URL="${UI_BASE_URL:-http://localhost:3000}"
echo "🔎 Checking UI at ${UI_URL} ..."
if ! curl -fsS "${UI_URL}" >/dev/null 2>&1; then
  echo "❌ UI not reachable at ${UI_URL}. Bring the stack up first: ./scripts/deploy-all.sh"
  exit 1
fi

cd ui
npx playwright install chromium >/dev/null 2>&1 || true
UI_BASE_URL="${UI_URL}" npx playwright test
```
Then: `chmod +x scripts/e2e-ui.sh`.

- [ ] **Step 8: List the tests to verify the suite is wired**

Run: `cd ui && npx playwright test --list`
Expected: lists the 3 tests in `e2e/auth.spec.ts` with no config/parse errors.

- [ ] **Step 9 (requires a running stack — may be user-run): execute the e2e**

Run: `./scripts/e2e-ui.sh`
Expected: 3 passed. If the stack is not up, Step 8 (`--list`) is the CI-independent verification and this step is deferred to the user.

- [ ] **Step 10: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/playwright.config.ts ui/e2e ui/.gitignore scripts/e2e-ui.sh
git commit -m "test(ui): Playwright e2e auth suite + scripts/e2e-ui.sh runner"
```

---

## Self-Review

**Spec coverage:**
- One-command bring-up incl. UI → Task 4 (deploy.sh/deploy-all.sh) + Task 3 (mapping/manifests) + Task 2 (image). ✓
- Browser reaches UI at :3000; UI→API in-cluster → Task 3 NodePort/mapping + Task 2 baked `http://bank-api:8081`. ✓
- Cluster recreation guard → Task 4 Step 1. ✓
- Unit tests (decodeJwtExpiry, friendlyErrorMessage, sanitizeNextPath) → Task 1. ✓
- `sanitizeNextPath` extraction + errors extraction → Task 1 Steps 6–9. ✓
- Playwright happy-path + silent-refresh + cookie-lifetime assertion → Task 5 Step 6. ✓
- `scripts/e2e-ui.sh` mirroring `agent/e2e_test.sh` → Task 5 Step 7. ✓
- SIN validity (`123456789`, len 9) → Global Constraints + Task 5 spec. ✓
- Verification-reality caveat (e2e may be user-run) → Task 5 Steps 8–9. ✓

**Placeholder scan:** No TBD/TODO; the one conditional ("if `public` absent, drop the COPY line" / "if form uses placeholders, use getByPlaceholder") is an explicit, resolved branch with instructions, not a deferral. ✓

**Type consistency:** `sanitizeNextPath(input, fallback?)`, `friendlyErrorMessage(ApiErrorBody, string)`, `decodeJwtExpiry(string): number | null`, image `nano-bank-ui:dev`, NodePort 30300 ↔ host 3000, `http://bank-api:8081` — consistent across tasks. ✓
