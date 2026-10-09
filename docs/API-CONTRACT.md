<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS shared API contract

ClinicsCMS serves one clinic or clinic group per installation. All durable entity records include `id`, `organizationId`, `version`, `createdAt`, and `updatedAt`. Roles, branch scopes, and patient links are resolved on the server; submitted role or organization fields do not grant authority.

Start with [installation](INSTALLATION.md) or [local development](DEVELOPMENT.md). When `OPENAPI_ENABLED=true`, the running API exposes its generated documentation at `/api/docs`. Keep this configuration deliberate; the documentation route does not replace API authentication or authorization.

## HTTP conventions

The REST prefix is `/api/v1`. Successful JSON responses use `{ data: ... }`; failures use `{ error: { code, message }, requestId }`. Downloads return their authorized binary representation. Use credentialed same-origin HTTP with an opaque session cookie and `X-CSRF-Token` for mutations. Cookies and CSRF tokens are issued by the authentication flow, never constructed by the browser.

- `GET /auth/session` returns the current session view.
- `POST /auth/login` accepts email, password, and an optional authenticator/recovery code.
- `POST /auth/logout` revokes the current session.
- `POST /auth/register` creates only a patient login. It never automatically links an existing patient record.
- Staff invitations, patient links, role changes, and initial-owner bootstrap have separate server-validated workflows.

`GET /records/:collection` lists actor-visible records; `GET /records/:collection/:id` reads one. `POST /records/:collection` creates through domain validation. `PATCH` requires writable fields plus `expectedVersion`; stale versions return `409`. Generic deletion is not available. The collection definitions live in `packages/contracts/src/index.ts` and input schemas in `packages/core/src/schemas.ts`.

`GET /dashboard` returns actor-specific counts and work. Clinical and financial transitions use `POST /actions/:action` with validated JSON. See [domain fields and actions](DOMAIN-API.md) for the request shapes and state rules.

## Server packages

The core package exports `ClinicService`, constructed with a `Database`. Its methods include `list(collection, actor, query?)`, `get(collection, id, actor)`, `create(collection, input, actor)`, `update(collection, id, input, actor)`, `execute(action, input, actor)`, and `dashboard(actor)`. Domain authorization applies inside the service as well as at HTTP boundaries.

The platform package exports theme, SEO/rendering, file, AI, and document services. See [platform integration](PLATFORM-API.md). Implementations receive a trusted authenticated actor or narrowly defined public context. Do not bypass the domain with a fabricated administrator for public requests.

Main server imports use relative ESM paths with `.js` suffixes for NodeNext; shared packages compile from the root TypeScript project. The web application can import browser-safe contracts through its configured paths, but must not receive database or provider credentials. Internal `@clinic/*` package scopes and existing storage/session identifiers remain stable for compatibility with earlier installations.

## Public and specialized routes

All paths below are relative to `/api/v1`.

| Purpose | Routes |
|---|---|
| Published clinic data | `GET /public/site`, `GET /public/pages/:slug`, `GET /public/services`, `GET /public/availability` |
| Inquiries and booking requests | `POST /public/leads`, `POST /public/booking` |
| Planning tools | `POST /public/tools/:tool` |
| Themes | `POST /themes/import`, `GET /themes/:id/preview`, `GET /themes/:id/export`, `POST /themes/:id/activate`, `POST /themes/rollback` |
| Private files | `POST /files` multipart upload; `GET /files/:id` authorized download |
| Approved public images | `POST /public-assets` multipart upload; `GET /public/assets/:id` public image |
| AI drafts | `POST /ai/draft`, `POST /ai/transcribe` |
| Provider payments | `POST /payments/:provider/checkout`, `POST /payments/:provider/refund`, provider reconciliation routes |
| Payment webhooks | `POST /webhooks/:provider`; verified raw body and provider signature required |
| Financial documents | `GET /documents/:id/pdf` after document authorization |

Public endpoints project only approved fields and apply validation and rate limits. The protected patient portal uses the same authorization model as the workspace. Payment redirects cannot confirm payment; only verified provider events and server reconciliation can establish it. Clinical AI output remains a reviewable draft.

Route implementations and current request validators are in `apps/api/src/controllers.ts`; authentication is in `apps/api/src/auth.ts`. The [theme development guide](THEME-DEVELOPMENT.md) explains package creation and the [website guide](WEBSITE-SETTINGS.md) explains draft/publication behavior.
