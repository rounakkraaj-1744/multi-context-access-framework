# MCAF — Adaptive Multi-Context Access Control Framework

A research-oriented access-control prototype built on Next.js 16 App Router, TypeScript, one SQLite database, server-side sessions, RBAC, and deterministic contextual policy checks. The starter repository had no existing database or identity data; the app creates a persistent local database at `data/mcaf.sqlite` and never deletes it automatically.

## Portals

One Next.js deployment currently serves three separately navigable workspaces over the same authentication and database:

- `/` — User Portal (sign in, registration, resources, profile, notifications)
- `/admin` is represented by the Admin workspace after an Admin signs in (`People`, `Approvals`, `Permission requests`, `Sessions`, `Decisions`, `Incidents`, `Context lab`, `Audit`)
- `/super-admin` is represented by the Super Admin role in that workspace, with platform-wide views and `Roles`, `Permissions`, and `Policies` management

The present UI uses role-specific navigation rather than separate deployment units. Deploying the same app behind separate hostnames can be added later; this prototype uses one first-party HTTP-only cookie and should not be split across subdomains without a deliberate shared-auth design.

## Setup

Prerequisites: Node.js 22.18+ and Bun 1.2.17 (the repository uses Bun; the database initializer uses Node's built-in TypeScript support).

```sh
bun install
cp .env.example .env.local
# Edit .env.local and replace the development-only seed credentials.
bun run db:init
bun run dev
```

Open `http://localhost:3000`. Local development initialization provisions two active starter accounts if their emails do not already exist:

| Role        | Email                  | Development password        |
| ----------- | ---------------------- | --------------------------- |
| Super Admin | `superadmin@mcaf.test` | `MCAF-SuperAdmin-Dev-2026!` |
| Admin       | `admin@mcaf.test`      | `MCAF-Admin-Dev-2026!`      |

These are development-only credentials. Change them before sharing a local instance. Account creation never overwrites an existing password or promotes an existing account. The initializer creates the schema idempotently and seeds role templates/resources/scenarios. Production initialization does not use these defaults. The development `POST /api/init` endpoint is disabled in production and can be protected with `INIT_TOKEN`.

Normal users may register through **Request access** at `/`. Registrations are stored as `PENDING`; they appear in the Admin and Super Admin people/approval views from the shared SQLite database. An administrator approves the account and assigns its requested role before it can sign in. There is no application limit on the number of normal registrations beyond available SQLite storage and operational capacity.

To use a different DB file, set `DATABASE_PATH` before running `bun run db:init` and the app. Keep the database on persistent storage. Back it up with a consistent SQLite backup, for example `sqlite3 data/mcaf.sqlite '.backup data/mcaf-backup.sqlite'`; restore only while the application is stopped and retain the original backup.

## Authentication and authorization

Passwords are bcrypt-hashed. Login issues a random 256-bit session token in an HTTP-only, SameSite=Lax cookie; only the SHA-256 token digest is stored in SQLite. Sessions expire after eight hours, can be explicitly invalidated by logout, and track server-observed last-seen/IP/user-agent data. Explicit logout and inactivity expiration use distinct status/reason fields. Login has a basic process-local IP attempt limiter; use a shared rate-limiting store before horizontal deployment.

Registration validates on the server, rejects duplicate email, stores a pending account, and does not grant portal access. Admins with `registrations:review` can approve or reject, and approval assigns the requested role (or Backend Engineer if none was requested). Admins cannot assign Admin/Super Admin accounts. Super Admins can manage account status, roles, permissions, and policies; Admin user and incident views are scoped by organization ID. Suspending or deactivating an account revokes its active sessions. The final active Super Admin cannot be disabled or demoted. Privileged changes are audited.

RBAC resolves the union of active role permissions and explicit user grants. The evaluator checks applicable policies against local-time windows, device/network availability, request frequency, context availability, and freshness. Missing context and failed required grant conditions deny; an applicable deny wins over step-up/grant. Policy time windows accept an IANA timezone and support overnight windows. Legacy `businessHoursOnly` policies use `BUSINESS_HOURS_START`/`BUSINESS_HOURS_END` (defaults 09:00–18:00) in `DISPLAY_TIMEZONE` (default Asia/Kolkata). Step-up requires password re-authentication tied to that session/resource/action and expires after five minutes. A successful verification still requires retrying the protected request. The access route returns resource content only after an `ALLOW`.

Every real protected-resource request records its access event, decision, context provenance, and server timestamp. Deterministic monitoring evaluates persisted requests for repeated authorization failures (default 5 denials in 120 seconds), high request volume (more than 30 requests in 300 seconds), and configured contextual policy failures. A single denial is recorded but does not alone create a repeated-denial alert. Active alerts are deduplicated by user and rule, include evidence event references, and notify active scoped Admins. Admins can acknowledge/investigate, mark incidents benign with a reason, or escalate. Super Admins can request more investigation or resolve escalated incidents with a reason. Automatic escalation for repeated denials is disabled unless `ANOMALY_AUTO_ESCALATE_DENIAL_LIMIT` is configured. These are investigation indicators, not findings of wrongdoing.

The observed context is limited to server request time, authenticated session state, and IP only when enabled behind a trusted proxy. Device identity/trust and network classification are unavailable unless integrated separately. Scenario Lab inputs are synthetic; no ordinary browser request can prove physical location, Wi-Fi SSID, or endpoint security posture.

## Research / Scenario Lab

Admins can run the 12 stored, labelled synthetic scenarios. The execution path calls the same policy evaluator and persists scenario outcomes and latency; these runs are not counted as production access events or behavior alerts. No scenario represents a real employee or production event. Device/network state is explicitly simulated in Scenario Lab; ordinary access requests do not accept arbitrary client-supplied context. The evaluator is a transparent prototype and not a trained anomaly detector. Reported metrics describe the labelled synthetic run only.

## Tests and checks

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```

The automated suite includes evaluator unit tests and HTTP-handler integration tests against a unique temporary SQLite database. It covers registration and approval, permission request review, role scope and self-escalation, policy access, step-up, anomaly notification, incident escalation/resolution, and session termination. Repeated request-rate detections are grouped into one open incident per user and rule; after closure, a new detection can open a new incident. Playwright/browser tests are not configured. The test suite never uses the development database.

## Environment variables

- `DATABASE_PATH`: SQLite path (default `./data/mcaf.sqlite`).
- `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`: optional development Super Admin seed override.
- `SEED_ORG_ADMIN_EMAIL`, `SEED_ORG_ADMIN_PASSWORD`: optional development Admin seed override.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`: legacy aliases for the original Super Admin initializer.
- `INIT_TOKEN`: optional header token for development-only POST `/api/init`.
- `DISPLAY_TIMEZONE`: configured display timezone; defaults to Asia/Kolkata.
- `TRUST_PROXY_HEADERS`: set to `true` only behind a trusted proxy that overwrites `X-Forwarded-For`; otherwise IPs are not retained.
- `ANOMALY_REQUEST_LIMIT`: requests per user above which a request-volume alert opens (default 30).
- `ANOMALY_REQUEST_WINDOW_SECONDS`: request-volume observation window (default 300 seconds).
- `ANOMALY_DENIAL_LIMIT`: denied requests that trigger a repeated-denial alert (default 5).
- `ANOMALY_DENIAL_WINDOW_SECONDS`: repeated-denial observation window (default 120 seconds).
- `ANOMALY_AUTO_ESCALATE_DENIAL_LIMIT`: optional repeated-denial count at which an incident is automatically escalated; unset disables automatic escalation.
- `BUSINESS_HOURS_START` / `BUSINESS_HOURS_END`: default local time window for legacy `businessHoursOnly` policies (defaults `09:00` / `18:00`).

No email provider is configured. Notifications are stored in-app in SQLite; there is no external email delivery claim. The SQLite schema is initialized idempotently in code and startup does not delete/reset records. `drizzle-orm` is installed and the shared DB client is available, but the initial schema currently uses explicit SQLite DDL rather than generated Drizzle migrations.

## Privacy, deployment, and prototype limits

IP addresses, user-agent summaries, login/logout history, access decisions, and context snapshots are retained in the local database without a configurable retention worker yet. Define retention, access-review, and deletion procedures before real workforce use. Avoid collecting precise location or Wi-Fi identity: this application does neither. SQLite is suitable for a small single-instance demo and has limited concurrent write capacity; use persistent disk, backups, and a single-writer deployment. Do not run multiple app instances against ephemeral or unsynchronized local filesystems.

This is an implementation prototype, not a production identity provider. Step-up uses password re-authentication rather than a second factor. Password reset, invitation workflow, custom organization administration, distributed rate limiting, configurable retention/expiry workers, XLSX, and Playwright tests remain future work. External email is not configured. SQLite is intended for a persistent, single-instance deployment. IP attribution is disabled unless explicitly enabled behind a trusted proxy. Access and incident records are retained without a configurable retention worker; establish retention and privacy processes before using workforce data.

## Administration APIs and UI

Super Admin configuration pages support audited role, permission, and contextual-policy CRUD, including timezone-aware access windows. Admins can review permission requests within their organization; grants are restricted to permissions already delegated to them. Behavior alerts are stored in `behavior_alerts`, scoped by organization, and visible in the Admin/Super Admin alert queues. The underlying routes are also guarded directly, so portal navigation does not grant authority. Account deletion is intentionally soft deactivation to preserve audit references. CSV exports support user and session reports, date filters, organization scope, and spreadsheet formula-prefix sanitization.

## Build notes

Next 16 Cache Components requires runtime cookie/database access to be deferred behind a Suspense boundary. The root page does this. In environments where Turbopack cannot start its CSS worker, use the supported Webpack build command `bun run build:webpack`; the default `bun run build` still exercises Turbopack.
