# Local host: browser scenarios

These scenarios are run by hand. They run `pwf dev` on a fixture
app with the local host mounted, and drive a real browser against it. Each
one checks something the Node contract test
(`src/__tests__/host/runner-contract.test.ts`) cannot check: the DOM, the
redirects a browser follows, cookies, and `sessionStorage` across reloads.

Fixtures: `src/__fixtures__/l-shop` (password and provider door; access rules:
members' own `Order`, public-create `Booking` read by `staff`), `l-members` (sign-in required), `l-social` (providers only),
`l-issuer` (external issuer with an audience).

## App door (password)

1. **Gate on a required app.** Open `l-members`. The sign-in wall shows a
   password form. No receipt request leaves the page (network panel: no
   `surfaces/…` request). A direct `GET <base>/surfaces/home.receipt.json`
   answers `401 SIGN_IN_REQUIRED`.
2. **Sign in.** Submit any e-mail and password. The wall closes without a
   reload, the refused page renders, and the account control shows
   "Developer". `sessionStorage["pwapp_session:<appId>"]` holds
   `{ token, expiresAt, principal }`.
3. **Reload keeps the session.** Reload the page. No `/login` request is made
   and the page renders signed in.
4. **Data round trip.** On the tasks page, submit the task form. The list shows
   the new row first, and the points total updates. Each request to
   `<base>/records/Task` carries `Authorization: Bearer <token>`.
5. **Sign out.** Use the account control. A `POST <base>/logout` (with
   `x-app-session`) and a `POST <base>/_auth/logout` (with
   `x-pwapp-request: 1`) are sent, the wall comes back, and the page content
   is removed from the DOM behind it.
6. **Closing the tab ends the session.** Open the app in a new tab after
   closing the old one: the wall shows.

## App door (providers)

7. **Provider round trip.** On `l-social`, press "GitHub". The browser goes to
   `<base>/_auth/start/github?returnTo=…`, then `<base>/_auth/callback/github`,
   then back to the page it started on (hash included). A `pwf_dev_session`
   cookie is set, `HttpOnly`, scoped to `<prefix>/_auth`. The page is signed in
   after one `GET <base>/_auth/session`.
8. **Single provider goes straight there.** With only one provider declared and
   no password door, the account control's "Sign in" goes straight to the
   provider (no wall).
9. **A failed round trip is shown.** Open
   `<base>/_auth/start/google?returnTo=/` on `l-social` (undeclared provider).
   The app loads with the wall showing the "provider unavailable" message and
   `auth_error` is gone from the address bar.
10. **Cross-site read is refused.** From another origin, `fetch` with
    credentials to `<base>/_auth/session` without `x-pwapp-request: 1`: `403`.

## Access rules

11. **Per-visitor rows.** On `l-shop`, sign in as `a@example.com`, create an
    order, and see it listed. Sign out, sign in as `b@example.com`: the order
    list is empty and the order's address answers `404`.
12. **Shared collections stay open.** Signed out, the product list and the
    spend total render; the order list shows its fallback or error state, not
    someone else's rows.

## External issuer

13. **PKCE through the stand-in.** On `l-issuer`, press "Sign in". The browser
    fetches `<base>/oidc/.well-known/openid-configuration`, goes to
    `<base>/oidc/authorize?…code_challenge_method=S256`, comes back to the app
    base with `?code&state`, and the page it started on is restored. The
    `code`/`state` parameters are gone from the address bar.
14. **Door token on receipts.** Every receipt request carries
    `Authorization: Bearer <door token>` (not the data token) and succeeds.
15. **Silent restore.** Reload: one `POST <base>/oidc/token` with
    `grant_type=refresh_token`, no redirect, signed in.
16. **Replayed callback.** Reload the URL that still carries an old
    `?code&state` (copy it before step 13 completes). The wall shows the
    "sign-in could not be completed" message.

## Envelope wiring

17. **Addresses come from the host.** The served `auth.json` names
    `<origin><prefix>/…` addresses only — no other host — and the served
    receipts' entity sources are `rest` sources against `<base>/records/…`.
18. **Definitions apply without a restart.** Add a required field to
    `entities.json` while `pwf dev` runs; the next create without it answers
    `400 VALIDATION_FAILED` and the form shows the message.
