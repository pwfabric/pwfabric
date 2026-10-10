# Security

## Reporting a vulnerability

Write to **security@phimajor.com**. Do not open a public issue, and do not
include the details in a pull request — a fix that describes the hole before
anyone can install it is worse than no fix.

Tell us what you found, how to reproduce it, and what an attacker gets. If you
are unsure whether something counts, send it anyway; deciding that is our job,
not yours.

## What happens next

- **Within two working days** you get a human reply confirming we have it.
- **Within ten working days** you get our assessment: whether we can reproduce
  it, how serious we think it is, and what we intend to do.
- When a fix ships, we publish an advisory naming the affected versions. If you
  want credit you will be named; if you would rather not be, say so.

## What is in scope

This repository: the PWFabric packages and anything they ship. A vulnerability
in an application *built* with PWFabric is in scope only if PWFabric itself
made it possible — for example, if the renderer executes something a surface
definition should never be able to execute.

A hosted service built on PWFabric is that service's own responsibility;
report its vulnerabilities to its operator.

## What is not a vulnerability

- A block author writing a component that does something unsafe. Blocks are
  code, and running the code you installed is the intended behaviour.
- A surface definition that renders content its author put there.
- Missing hardening that would only matter with a configuration we document as
  unsupported.

If you disagree with one of these in a specific case, argue it — the list is a
default, not a wall.
