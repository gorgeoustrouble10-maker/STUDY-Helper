# Repository layout

- `apps/mobile`: standalone Android client. Read its AGENTS.md before changes; its Expo/React versions and dependencies are independent of the web app.
- `apps/web`: existing Next.js web application and its owner-only APIs, Prisma models and migrations. Read its AGENTS.md and local Next.js docs before changes.
- `services/mobile-api`: isolated multiuser mobile backend; Node.js 24 built-ins only. No web owner session or database access belongs in mobile handlers.
- `deploy`: infrastructure configuration; `docs`: shared documentation; `artifacts`: build verification metadata, with APKs ignored by Git.

Run commands from the repo root through package scripts, or run a package's commands from that package directory. Do not hoist mobile and web dependencies or import server modules into the Android bundle.

Use `npm run check` for type checks, mobile lint and unit/integration tests, and `npm run web:build` to verify the relocated Next.js production build. Android builds stay local; do not install APKs in an emulator unless the user requests it.

Dates are stored as UTC instants and edited/displayed in Asia/Shanghai. Preserve incomplete date input while typing; convert only at save. System creation timestamps remain immutable.
