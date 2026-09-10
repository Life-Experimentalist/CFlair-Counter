# ViewFlare

This project reports view counts, install counts and events to a ViewFlare
instance: a small counter API running as a Cloudflare Worker on D1.

## Read the contract first

Every ViewFlare deployment serves its own documentation, so there is nothing to
memorise and nothing to keep in sync. Before writing any call:

1. Fetch `https://<instance>/llms.txt` for the short version of every endpoint.
2. Fetch `https://<instance>/openapi.yaml` for request and response shapes.

Replace `<instance>` with this project's ViewFlare host. If you do not know it,
ask. Do not guess a domain, and do not fall back to someone else's instance.

## The two calls you will need most

Record a view. Fire and forget, never block the page on it:

```js
fetch("https://<instance>/api/views/<project>", {
	method: "POST",
	keepalive: true,
}).catch(() => {});
```

Show the count as a badge:

```md
![Views](https://<instance>/api/views/<project>/badge?style=flat-square)
```

## Naming

A project name is any URL-safe slug up to 100 characters, created on first use.
A dot makes it a path: `acme.api.docs` sits under `acme.api`, which sits under
`acme`. Read a whole subtree with `GET /api/views/acme?rollup=1`, which returns
the sum plus the per-project breakdown in `members`. Matching is on whole
segments, so `acme_other` is never counted under `acme`.

## Rules

- Tracking is fire and forget. Swallow the error and set a short timeout, so a
  failed counter call cannot break the thing it is measuring.
- A number that could not be fetched is reported as unavailable, never as 0.
  Check `unavailable`, `partial` and `stale` before using a figure. Never
  substitute a zero, and never invent or estimate a number.
- `POST /api/views/{project}` increments. `GET /api/views/{project}` does not.
  Never use POST to read a count.
- A `+` in a query string decodes to a space, so write it as `%2B` inside any
  `expr=` parameter.
- Only the admin routes take a password. Never put an admin password in a
  client-side call, a badge URL, or a committed file.

## One number out of several

`GET /api/compute/{project}?expr=...` evaluates arithmetic over the numbers the
instance already holds and answers with a single value. It has `/badge` and
`/shields.json` siblings that take the same `expr`.

Variables are `views.total`, `installs.total`, `installs.<source>`,
`events.<category>` and `events.<category>.<name>`.
`/llms.txt` lists the operators and functions.

```
https://<instance>/api/compute/<project>/badge?expr=views.total%2Binstalls.total&label=reach
```

Source and full docs: https://github.com/Life-Experimentalist/ViewFlare
