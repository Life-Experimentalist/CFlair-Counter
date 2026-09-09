# API reference

The machine-readable description of every ViewFlare endpoint lives in one file:

- In the repository: [`public/openapi.yaml`](../../public/openapi.yaml)
- On a running instance: `https://your-domain.com/openapi.yaml`

It is OpenAPI 3.1 and covers all 20 paths the Worker serves, including the
admin routes, the badge shapes and the `/api/compute` expression endpoint.

## What to read instead, depending on what you want

| You want | Read |
| --- | --- |
| To call the API from code, with worked examples | [INTEGRATION.md](../../INTEGRATION.md) |
| A recipe list you can copy and adapt | [AI-AGENT-QUICKSTART.md](../AI-AGENT-QUICKSTART.md) |
| The short version, for an agent with only the domain | `https://your-domain.com/llms.txt` |
| Field-by-field request and response shapes | `openapi.yaml`, this file |

## Generating a client

The spec is plain OpenAPI, so the usual generators work without a plugin:

```bash
npx @redocly/cli preview-docs public/openapi.yaml
```

```bash
npx @hey-api/openapi-ts -i https://your-domain.com/openapi.yaml -o src/viewflare
```

## Two things a generated client will not tell you

**Encode the plus sign.** `GET /api/compute/{project}` takes its formula in the
query string, and a `+` there decodes to a space. Write it as `%2B`. Most
generated clients will encode it for you; a hand-written URL will not.

**Check the availability flags before using a number.** A figure that could not
be fetched is reported as `null` with `unavailable: true`, never as 0. The same
applies to `partial` (fewer registries answered than are configured) and
`stale` (the value came from cache after an upstream failed). A client that
reads `value` alone will eventually report a wrong number as if it were right.

## Keeping the spec honest

The spec is written by hand, so it can drift from the Worker. When you add or
change a route in [`functions/index.ts`](../../functions/index.ts), update
`public/openapi.yaml`, [`public/llms.txt`](../../public/llms.txt) and the
endpoint table in [README.md](../../README.md) in the same change.
