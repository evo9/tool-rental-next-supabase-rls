# Tool Rental

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000000?logo=shadcnui&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Row Level Security](https://img.shields.io/badge/Row_Level_Security-enforced-3FCF8E)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1?logo=zod&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?logo=nodedotjs&logoColor=white)

A tool-rental point-of-sale app on Next.js and Supabase. It is a learning and portfolio project, and its subject is **role-based access control enforced inside Postgres**: permissions are grants, row-level security policies and triggers in the database. The checks in the UI only make the interface friendlier; they never replace the ones in the database.

The repository is written to be read like a textbook. Every migration explains each policy, function and trigger, every stage has a chapter in [`docs/book/`](docs/book/README.md), and the permission matrix is proven with real API requests rather than claimed.

## What it does

- Staff sign in (sign-up is disabled; a superadmin creates staff rows) with one of three roles: `OPERATOR`, `MANAGER`, `SUPERADMIN`.
- Customers with a category (`PLATINUM`, `GOLD`, `SILVER`, `NON_GRATA`), photo of the customer and of the document in a private bucket.
- Tool models and physical units with statuses, QR labels for printing, CSV import with a per-row error report.
- Rentals: issue, partial return with photos, price and overdue calculated in the database, an audit log nobody can forge.
- A dashboard with live counters.

## Permission matrix

Roles are hierarchical: each one can do everything the previous one can. **Empty** and **0 rows** mean the request succeeded but RLS let nothing through; **42501** means permission denied.

| Data | Action | OPERATOR | MANAGER | SUPERADMIN | not staff | anon |
|---|---|---|---|---|---|---|
| tools | read | yes | yes | yes | empty | 42501 |
| tools | create, update | 42501 / 0 rows | yes | yes | 42501 / 0 rows | 42501 |
| tools | delete | 0 rows | 0 rows | yes | 0 rows | 42501 |
| tool_units | read | yes | yes | yes | empty | 42501 |
| tool_units | create (`AVAILABLE` / `UNAVAILABLE` only) | 42501 | yes | yes | 42501 | 42501 |
| tool_units | change status | 0 rows | yes, if the transition is valid | yes, if valid | 0 rows | 42501 |
| tool_units | delete | 0 rows | 0 rows | yes, if never rented | 0 rows | 42501 |
| customers | read, register (SILVER), edit name and phone | yes | yes | yes | empty / 42501 / 0 rows | 42501 |
| customers | register with another category, change category | 42501 | yes | yes | 42501 | 42501 |
| customers | delete | 42501 | 42501 | 42501 | 42501 | 42501 |
| rentals, rental items | read, issue, return, edit note | yes | yes | yes | empty / 42501 | 42501 |
| rentals, rental items | write `status`, `amount`, prices, timestamps directly | 42501 | 42501 | 42501 | 42501 | 42501 |
| rentals, rental items | delete | 42501 | 42501 | 42501 | 42501 | 42501 |
| grace periods | read | yes | yes | yes | empty | 42501 |
| grace periods | update | 0 rows | yes | yes | 0 rows | 42501 |
| staff | read own row | yes | yes | yes | - | 42501 |
| staff | read, create, update, delete others | empty / 42501 | empty / 42501 | yes (cannot lock itself out) | empty / 42501 | 42501 |
| audit log | read | empty | empty | yes | empty | 42501 |
| audit log | write | 42501 | 42501 | 42501 | 42501 | 42501 |
| dashboard counters | read | yes | yes | yes | a row of zeros | 42501 |
| CSV import (RPC) | run | every row 42501 | yes | yes | every row 42501 | 42501 |
| storage (`customer-photos`, `rental-photos`) | upload into an existing record folder, read, signed URL | yes | yes | yes | 42501 / empty | 42501 / empty |
| storage | overwrite, delete | no policy | no policy | no policy | no policy | no policy |

A deactivated employee (`staff.is_active = false`) behaves like "not staff" from the very next request. The full, cell-by-cell result of real API requests is in [`docs/policy-matrix-report.md`](docs/policy-matrix-report.md).

## How to verify

Everything runs against your own Supabase project (see "Getting started"). Run `npm run seed:staff` first.

```bash
npm run test:sql       # SQL tests in tests/: roles, policies, triggers, RPC
npm run test:api       # the matrix through the real API, writes docs/policy-matrix-report.md
npm run test:all       # both
npm run check:bundle   # builds the app and looks for secrets in .next/static
```

- `test:sql` runs every file in `tests/` in order with `psql` (falls back to `supabase db query --linked` if `psql` is missing) and stops at the first failure. Each file runs inside a transaction that is rolled back.
- `test:api` signs in as five actors (anon, a deactivated operator, an operator, a manager, a superadmin) with real JWTs, performs every action against PostgREST and the Storage API, and compares the answer with the expected one. Any mismatch exits with a non-zero code and names the cell. It also shows that a deactivated employee loses access without a new token. Data created by a run carries the prefix `__matrix-`; `tests/manual/cleanup-matrix-data.sql` removes what the API cannot.
- `check:bundle` fails if the value of the secret key, the seed password or the string `service_role` appears in the browser bundle, or if a `NEXT_PUBLIC_` variable looks like a secret.
- To see the matrix catch a broken policy: run `tests/manual/break-policy.sql`, then `npm run test:api` (it fails on exactly one cell), then `tests/manual/restore-policy.sql`.

## Where the role lives: table, not JWT

<!-- Draft paragraph: the author rewrites this section in their own words. -->

The role is stored in the `staff` table. Policies call `current_staff_role()`, a `security definer` function that reads `staff` by `auth.uid()`. Changing a role or deactivating an employee takes effect on the next request, without waiting for the token to expire. The price is one read of `staff` per request, which the `(select ...)` wrapper in every policy reduces to once per query.

The alternative is to put the role into the JWT with a Custom Access Token Hook and read it in policies via `auth.jwt()`. That avoids the table read, but the token lives for up to an hour by default, so a demotion or a deactivation lags behind. For a point of sale where a dismissed operator must not keep issuing tools, that delay is unacceptable. `npm run test:api` demonstrates it: one session, one unchanged token, access gone right after `is_active` is set to `false`.

## Getting started

Requirements: Node.js 20+, a free [Supabase](https://supabase.com) account, and `psql` if you want the SQL tests to show per-check output.

1. Clone the repository and run `npm install`.
2. Create a project in Supabase. In the project settings, **disable automatic grants and automatic RLS for new tables** (this project writes every grant explicitly, that is the point) and **disable sign-ups** (Authentication settings). The first superadmin is created by the seed script, the rest by a superadmin.
3. Copy `.env.example` to `.env.local` and fill it in: project URL, publishable key, secret key, a password for the test users (`SEED_PASSWORD`), optionally the database connection string (`DB_URL`, used only by `psql`). The secret key is used only by scripts and must never be prefixed with `NEXT_PUBLIC_`.
4. Link the project: `npx supabase link` and choose it.
5. Apply the migrations: `npm run db:push`.
6. Create the test staff and sample tools: `npm run seed:staff`. It creates `operator@`, `manager@` and `admin@example.com`, a deactivated `inactive@example.com`, and a few tool models with units.
7. Start the app: `npm run dev`, open <http://localhost:3000> and sign in as one of the test users with `SEED_PASSWORD`.

To check the QR labels from a phone, set `NEXT_PUBLIC_APP_URL` to your computer's address in the local network (for example `http://192.168.0.10:3000`) and add it to `allowedDevOrigins` in `next.config.ts`.

## Private photo storage

Photos of customers and of tools at issue and return live in private buckets (`customer-photos`, `rental-photos`), created by migrations. Policies on `storage.objects` let an active employee upload only into the folder of an existing customer or rental item and read; there are no UPDATE or DELETE policies, so files are immutable: a replacement is a new file and the old one stays as history. The database keeps a path, not a URL; the server creates a 60-second signed URL with the user's own session, so only someone who passes the read policy can get one.

## Repository layout

```
supabase/migrations/   numbered SQL: tables, grants, policies, functions, triggers
tests/policies/        SQL tests of roles and policies (test:sql)
tests/pricing/         SQL tests of the tariff function
tests/api/             the permission matrix through the real API (test:api)
tests/manual/          break and restore a policy on purpose, clean up test data
scripts/               seed, SQL test runner, bundle check
src/features/          queries, actions, types and components per feature
src/lib/supabase/      session client (server, browser); admin client for scripts only
docs/book/             the textbook: one chapter per stage
docs/roles.md          the permission matrix, in detail
docs/rls-notes.md      short notes taken while learning RLS
```

## Learning path

To learn the project rather than just run it, read [`docs/book/README.md`](docs/book/README.md): one chapter per stage, from the first policy to the permission matrix, each with the new mechanics explained from scratch, the decisions and their alternatives, and self-check questions. Read the chapter, then the migration it points to.
