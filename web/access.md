# Access-request configuration

The public testnet investment demo does not require an access request. The
separate Request Access form stores contact requests through a Cloudflare Worker
and D1 database; it does not grant ATS eligibility.

1. Create a Managed Turnstile widget for the exact domains serving the form.
2. Generate an API secret with `openssl rand -hex 32`.
3. Configure the frontend deployment with:

   ```env
   ACCESS_REQUEST_API_URL=https://sidereal-access-requests.hypersettle.workers.dev
   ACCESS_REQUEST_API_TOKEN=<shared API secret>
   TURNSTILE_SITE_KEY=<public Turnstile site key>
   ```

4. From `web/app`, set the access Worker secrets:

   ```bash
   pnpm exec wrangler secret put ACCESS_REQUEST_API_TOKEN --config ../workers/access-requests/wrangler.jsonc
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --config ../workers/access-requests/wrangler.jsonc
   ```

5. Redeploy the frontend, submit a test request and confirm its record in the
   access-request D1 database. Never commit secret values.

The Worker enforces Turnstile, rate limits and a 10,000-email capacity limit.
