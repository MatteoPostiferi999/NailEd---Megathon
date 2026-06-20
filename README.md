Megathon - Nailed!

Participants:

Matteo Postiferi
Niccolò Caselli
Francesco Massafra
Beshoy Guirges

## App

The React frontend and Base44 backend live in `app/`.

```bash
cd app
npm install
npm run dev
```

Base44 backend resources are in `app/base44/`, including entities and functions.
Set `GEMINI_API_KEY` and `CLOUDINARY_URL` in Base44 secrets before using real nail preview generation and image uploads.

## Stripe

This app uses custom Base44 functions that call Stripe directly with your own key.
It does not use a Base44 built-in Stripe integration.

Set these Base44 function secrets before testing payments:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Add your deployed `stripeWebhook` function URL in the Stripe Dashboard as a webhook
endpoint for `checkout.session.completed`. The backend checkout packages are
configured in `app/base44/functions/createStripeCheckout/stripePackages.ts`; the
frontend display data lives in `app/src/data/stripeCreditPackages.ts`.
