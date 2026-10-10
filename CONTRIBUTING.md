# Contributing to PWFabric

## Before you write code

Open an issue for anything larger than a fix. Not for permission — so that
someone can tell you if the thing you are about to build already exists under
another name, or is about to be deleted.

Fixes with a failing test attached need no issue. Send them.

## The one rule that is not negotiable

**`@pwfabric/contracts` is a promise, not a package.** Every consumer of PWFabric
— including applications we have never seen, running on servers we do not
operate — agreed to those types. So:

- Adding an optional field is a minor change.
- Renaming, removing, or narrowing anything already published is a major change,
  and needs a migration path shipped with it.
- "Nobody uses this" is not a measurement unless you can show how you measured
  it. Published packages are downloaded by people who never open an issue.

If your change makes a contract stricter, expect the review to be slow. That is
the contract working.

## What the engine may not know

PWFabric renders apps. It does not know about accounts, plans, billing, tenants,
marketplaces or anything else that belongs to a platform built on top of it. A
pull request that teaches the engine one of those concepts will be declined even
if the code is good — that separation is what lets an app run without us.

Endpoints are configuration, never constants. If your change needs to talk to a
server, the address comes in as a parameter.

## Running the repository

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Describe behaviour in code comments and commit messages rather than citing
where it was decided: a reader of this repository cannot open your notes.

## Tests

A bug fix comes with the test that fails without it. A new capability comes with
tests for what it does when its inputs are wrong, because that is the part
users meet.

The renderer degrades rather than throws. A test that asserts a throw where the
runtime is meant to warn is testing the wrong contract.

## Commits and pull requests

Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`),
imperative mood, header under 120 characters. Say in the body what changed and
why the change is safe; a reviewer should not have to reconstruct your reasoning
from the diff.

Keep a pull request to one coherent change. Size is not the limit — a migration
is one change even when it touches forty files — but two unrelated changes in
one branch make both harder to accept.

## What happens to your contribution

Merged contributions are licensed under the licence of the package they land in
— Apache-2.0 or BSL 1.1, as stated in that package's `LICENSE`.
By opening a pull request you confirm you have the right to contribute the code
and are content for it to ship under those terms.

## Where to ask

Questions about using PWFabric: [pwfabric.com](https://pwfabric.com).
Questions about a change you are making: the issue for that change, at
[github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric/issues).
Security: **security@phimajor.com**, never a public issue.
