# LegalEase API

Express API for the LegalEase legal-professional discovery, hiring, payment, comment, and administration workflows.

## Stack

Node.js, Express, MongoDB Atlas/Mongoose, Zod, JWT HTTP-only cookies, Google Identity Services verification, Stripe Checkout/webhooks, and backend-mediated imgBB uploads.

## Local setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and supply your own values. Never commit real credentials.

```bash
npm test
npm run seed:admin
```

Health check: `GET /api/health`.

## Production architecture

The API deploys as a separate Vercel Express application. The root `index.js` exports the app handler for Vercel and establishes a reusable MongoDB Atlas connection; `src/server.js` remains the local listener only.

The React client proxies same-origin `/api/*` traffic to this API deployment. Stripe calls `/api/payments/stripe/webhook` directly on the API deployment.

## Required production environment names

```text
NODE_ENV
MONGODB_URI
MONGODB_DB_NAME
CLIENT_ORIGINS
JWT_SECRET
COOKIE_NAME
GOOGLE_CLIENT_ID
GOOGLE_ONBOARDING_SECRET
GOOGLE_ONBOARDING_COOKIE_NAME
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CURRENCY
LAWYER_PUBLISHING_FEE_CENTS
IMGBB_API_KEY
ADMIN_NAME
ADMIN_EMAIL
ADMIN_PASSWORD
```

Only variable names belong in documentation. Secrets belong in Vercel server environment settings.

## Security model

- Current database role/status, ownership, and state transitions are authoritative.
- Payment state is established only by verified, raw-body Stripe webhooks.
- Public responses use safe DTOs; auth, Stripe, and secret fields are never public.
- Production requires exact client origins and a MongoDB URI.
