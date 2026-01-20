# Football Scores Pro (Netlify + Web Push)

## What you get
- PWA installable web app (Netlify hosting)
- True Web Push notifications (works even when the site is closed)
- Notification actions: Copy / Open
- Server-side ESPN polling (avoids browser CORS/proxy caching)

## Setup (Netlify)
1) Deploy this repo to Netlify.
2) Add environment variables:
   - VAPID_PUBLIC_KEY
   - VAPID_PRIVATE_KEY

Generate VAPID keys locally:
    npx web-push generate-vapid-keys

3) Open the site, click **Enable Push** and allow notifications.
4) (Android) Install as a PWA: Chrome menu → Add to Home screen.

## Notes
- Goal notifications are detected by score change from ESPN scoreboard.
- Scorer names + OG/P require play-by-play extraction; can be added once you confirm ESPN fields you want.
- Your output rules are enforced:
  - No "$ match postponed"
  - No "$ no goals yet"
  - No "$ end match (4-2 on penalties)"
  - AET outputs: "$ end match AET"
  - Penalties: "$ set penalties X-Y" (needs reliable shootout fields)
