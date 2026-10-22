# Lerang

A web auction application for participants, auction officers, and administrators, covering item submissions, bidding, payments, and delivery records.

## Features

- Item submissions, photo uploads, and officer review.
- Auction scheduling, bidding, deposits, and automatic bidding limits.
- Wallet records, invoices, and payment status checks.
- Delivery and local pickup records.
- Admin work queues, date-range statistics, and PDF/CSV reports.

## Tech stack

- Frontend: React, TypeScript, Vite, and Tailwind CSS.
- Backend: Go with a REST API built on `net/http`.
- Authentication: Firebase Authentication.
- Database: Firebase Realtime Database through the Firebase Admin SDK.
- Payments: Midtrans Snap in Sandbox mode.
- Reports: Recharts, jsPDF, and CSV exports.

React sends Firebase ID tokens to Go, which checks access, validates requests, and updates RTDB. Payment and balance changes are verified on the server. Frontend data refreshes through polling.

MySQL is only used by the optional migration tool, not by the application at runtime.

## Requirements

- Node.js 24+ and npm. Tests use [Node's native TypeScript support](https://nodejs.org/api/typescript.html).
- Go 1.26.5 or newer, as specified in `go.mod`.
- A Firebase project with Authentication, Realtime Database, and a service-account key.
- Midtrans Sandbox credentials to test payments.

## Local setup

### 1. Install dependencies

```sh
git clone https://github.com/dreallry/Lerang.git
cd Lerang
npm ci
```

### 2. Configure the environment

Copy `.env.example` to `.env` and replace the placeholders with your own settings.

| Configuration | Purpose |
| --- | --- |
| `VITE_FIREBASE_*` | Public Firebase Web App configuration. Fill every field in the template. |
| `FIREBASE_CREDENTIALS` | Path to your service-account JSON file. |
| `FIREBASE_DATABASE_URL` | RTDB URL; must match `VITE_FIREBASE_DATABASE_URL`. |
| `FIREBASE_STORAGE_BUCKET` | Optional server-side bucket configuration for uploads. |
| `PHOTO_UPLOAD_DIR` | Server photo directory used when Firebase Storage is unavailable. |
| `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY` | Credentials from one Sandbox account. |
| `MIDTRANS_IS_PRODUCTION` | Keep `false` for development. |
| `VITE_API_BASE_URL`, `VITE_APP_URL` | API path and frontend URL. Defaults: `/api` and `http://localhost:5173`. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins. |

Save the service account at `secrets/firebase-service-account.json`, or update its path. Use the same Firebase project for both configurations.

Enable Email/Password and authorize your frontend domain in Firebase Authentication. Enable the Google provider to use Google sign-in.

Apply `database.rules.json` to RTDB. These rules deny direct client access; data is served through Go.

### 3. Start the application

Start the Go API and frontend together:

```sh
npm run dev
```

Open `http://localhost:5173`. The command builds Go, waits for its Firebase configuration and a successful catalog read, then starts Vite. It reuses a recognized API only if that catalog read succeeds and only stops processes it started. Use `npm run check:firebase` for separate Auth and Storage checks.

Vite proxies `/api` to Go on `PORT` (default `8080`). Restart both after changing environment settings. If the frontend is already running, use `npm run dev:api` to start only the missing API. For separate terminals, use `npm run dev:api` and `npm run dev:web`; the frontend alone cannot load the catalog or verify account roles.

If you use a manually built `server.exe`, stop it and rebuild with `go build -o server.exe .` after backend changes. An old executable continues running old code even when the source files have been updated. The development command builds a fresh API when no API is running.

A new database starts empty. Create a staff account, add a lot, then assign it to an auction session.

### 4. Create a staff account

Replace the example email with an address you control:

```sh
go run ./scripts/provision-firebase-staff --email admin@example.com --role administrator
```

This provisions Auth and the RTDB role. Use `petugas` for an officer. Set the password through **Forgot password** on the login page. Participants register in the application.

## Payments and uploads

Go verifies Sandbox orders with Midtrans before updating funds. Set the notification URL to your public HTTPS API address followed by `/api/midtrans/webhook`.

Uploads use Firebase Storage when available; otherwise, `PHOTO_UPLOAD_DIR=uploads/lot-photos` enables server storage. Each item supports 12 photos, up to 10 MB per file: JPG, PNG, WebP, or GIF.

Server storage is capped at 500 MB. Removing a photo from a form keeps its file on disk; clean up unused files during maintenance. Back up photos with RTDB data.

Uploads allow four files in progress across the API process and one per account. Busy requests return a retry message before reading the file.

## Data consistency

Go serializes writes within one API process and uses Firebase ETags for atomic updates across related records. Access is checked again against the transaction snapshot. Stale item edits, curation decisions, and shipping quotes require a reload before they can be saved.

Concurrent catalog reads share a short, 250 ms cache. Identity and financial reads bypass it; writes invalidate it. Polling pauses while offline or hidden and refreshes on return.

Local fixture tests cover 100 concurrent transactions and deposit locks. They do not establish production capacity: writes still transact at the RTDB root, so larger datasets or multiple API instances need further load testing and a narrower transaction model.

## Checks and builds

```sh
npm test
go test ./...
npm run build
```

| Command | Purpose |
| --- | --- |
| `npm run check:firebase` | Check project settings, Auth, RTDB access, and the Storage bucket. |
| `npm run check:payments` | Check Sandbox Server Key access without creating a payment. |
| `npm run check:admin-modules` | Check admin page imports while the Vite dev server is running. |
| `npm run accounts:list` | List account readiness for local administration. Keep its output private. |
| `npm run preview` | Preview the frontend build; keep the Go API running. |
| `npm run build:auth` | Build standalone email action pages into `dist-auth/`. |

The Firebase check accepts the configured server photo directory when Storage is unavailable. Go checks whether that directory can be opened at startup. The payment check validates Server Key access; checkout is needed to confirm the Client Key pairing.

## Deployment

Build the frontend with `npm run build` and serve `dist/`. Run Go as a separate service with its own environment and service-account configuration.

- Forward `/api`, including `/api/photos`, from the website to Go.
- Set `VITE_APP_URL`, Firebase authorized domains, and `CORS_ALLOWED_ORIGINS` for the deployed website.
- Use persistent storage for photos and keep credentials outside public directories.
- Set the public Midtrans notification URL for the deployed API.

`firebase.json` deploys email action pages from `dist-auth/`, not the main frontend or Go API. Update its site setting for your Firebase project. Custom password-reset links require the matching action URL in Firebase Authentication.

## Project structure

```text
api/         Go handlers, validation, transactions, and backend tests
src/         React pages, shared components, API client, and utilities
tests/       Frontend logic tests and browser fixtures
scripts/     Service checks, staff provisioning, and MySQL migration
public/      Public application assets
```

The [operations and migration guide](scripts/README.md) is currently in Indonesian. Real accounts and database dumps are not included.

## Current limits and private files

Withdrawals, shipping fees, and delivery progress require staff records and external handling. Automated bank transfers and carrier APIs are not integrated. Payments use Sandbox, not live charging.

`.env`, service accounts, `secrets/`, uploads, database dumps, verification records, and builds are excluded from Git. `VITE_*` values are public in the browser bundle. Keep private keys and the Midtrans Server Key on the server.
