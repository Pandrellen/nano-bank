# Nano-Bank UI

A Next.js (App Router) frontend for the nano-bank API.

## Pages

- `/` — splash page.
- `/auth/signup`, `/auth/signin` — customer registration and login forms.
- `/dashboard` — protected; requires a valid session, otherwise redirects to `/auth/signin`.
- `/privacy`, `/terms` — static Privacy Policy / Terms of Service pages.
- `/health` — pings the API's `/health` endpoint.

`Header` and `Footer` (`src/components/`) are shared across pages. `Header` is
authentication-aware: it shows a "Sign In" link when signed out, or
"Dashboard" + "Log out" when a session is active.

## Auth

Sign-up, sign-in, logout, and token refresh are Next.js server actions
(`src/actions/auth.ts`) that call the API's `/api/v1/auth/*` and
`/api/v1/customers` endpoints directly — no auth logic lives in the browser.

- On sign-in, the API's `access_token` / `refresh_token` are stored as
  `httpOnly` cookies.
- `/dashboard` verifies the `access_token` server-side against
  `GET /api/v1/customers/profile` on every load, redirecting to `/auth/signin`
  if it's missing or rejected.
- `/dashboard` decodes the access token's `exp` claim server-side
  (`src/lib/jwt.ts`) and passes it to `TokenCountdown`, a client component
  that ticks down the remaining lifetime every second. Once it hits zero, it
  calls `refreshSessionAction` to silently rotate in a new access/refresh
  pair. If the refresh token itself is invalid or expired, the user is sent
  back to `/auth/signin`.
- `logoutAction` calls `POST /api/v1/auth/logout` and clears both cookies.

## Config

Create a `.env` file in the root of the `ui` directory:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8081
```

## Running
Note that Node ≥ 20.9.0 is required for running this app.

1. Ensure the API is running.
2. From within the `ui` directory:

```bash
npm install
npm run dev
```

3. Open browser at `http://localhost:3000`
4. Visit `/health` to confirm the API is reachable, or go to `/auth/signup` to create an account and sign in.
