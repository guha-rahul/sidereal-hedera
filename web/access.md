# Access-request setup for Polov

Hi Polov, the request-access UI and Cloudflare storage are already built. The
site remains on your Vercel account; Cloudflare only runs the private API and
stores requests in D1.

1. In Cloudflare Turnstile, create a **Managed** widget for `sidereal.tech` and
   `www.sidereal.tech`. Keep its site key and secret key separate.
2. Generate a shared API secret with `openssl rand -hex 32`. Do not commit or
   send this value in chat.
3. Add these Production environment variables to the Vercel project:

   ```env
   ACCESS_REQUEST_API_URL=https://sidereal-access-requests.hypersettle.workers.dev
   ACCESS_REQUEST_API_TOKEN=<the generated shared secret>
   TURNSTILE_SITE_KEY=<the Turnstile site key>
   ```

4. Add the matching secrets to the Cloudflare Worker from the `app` directory;
   each command will securely prompt for its value:

   ```bash
   pnpm exec wrangler secret put ACCESS_REQUEST_API_TOKEN --config ../workers/access-requests/wrangler.jsonc
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --config ../workers/access-requests/wrangler.jsonc
   ```

5. Redeploy Production in Vercel, open **Request Access**, and submit one test
   request. Confirm it appears in the `sidereal-access-requests` D1 database,
   then remove the test record if desired.

The database accepts at most 10,000 unique email addresses. Turnstile, rate
limiting, and the cap are enforced by Cloudflare rather than by the browser.
