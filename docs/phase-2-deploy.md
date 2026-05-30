# Phase 2 — Deploy Runbook (Live Dashboard)

Deploys the WebSocket backend (`F1-Realtime`) and the Next.js frontend (Vercel).
Run from the repo root. Replace `<profile>` / `<account>` with your values
(Martin: profile `private`, account `128663321407`, region `eu-central-1`).

> Prereqs: Phase 0/1 already deployed (`F1-DataLayer`, `F1-Pipeline`), Node ≥ 20,
> pnpm ≥ 9, AWS CLI v2, a Vercel account.

## 1. One-time: WebSocket token secret (SSM)

The `$connect` authorizer reads an HMAC secret from SSM. It is **never** in the
CDK template (Constitution VII) — create it once, out of band:

```bash
# Generate a strong random secret and store it as a SecureString.
SECRET=$(openssl rand -hex 32)
AWS_PROFILE=<profile> aws ssm put-parameter \
  --name /f1/ws-token-secret --type SecureString --value "$SECRET" \
  --region eu-central-1
echo "$SECRET"   # keep this — it also goes into Vercel as WS_TOKEN_SECRET
```

## 2. Pre-deploy validation (all green before deploying)

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk synth F1-Realtime
```

## 3. Deploy the WebSocket backend

```bash
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk deploy F1-Realtime
```

Note the stack output **`WebSocketUrl`** — e.g.
`wss://abcd123.execute-api.eu-central-1.amazonaws.com/live`. You can re-read it:

```bash
AWS_PROFILE=<profile> aws cloudformation describe-stacks \
  --stack-name F1-Realtime --region eu-central-1 \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" --output text
```

The deploy also creates: `F1-Connections` (DDB), 6 `F1-WS-*` lambdas, the
`f1-realtime` CloudWatch dashboard, and 3 alarms on the existing `f1-alerts`
topic. Confirm the SNS email subscription if it isn't already.

## 4. Configure + deploy the frontend (Vercel)

Vercel project settings:

- **Root directory:** `apps/dashboard`
- **Build command:** `pnpm -F @f1/dashboard build` (or default `next build` from the root dir)
- **Install command:** `pnpm install` (run at repo root for the workspace)

Environment variables (set for **Preview** and **Production** separately):

| Name                 | Value                                      | Exposed |
| -------------------- | ------------------------------------------ | ------- |
| `NEXT_PUBLIC_WS_URL` | the `WebSocketUrl` output from step 3      | browser |
| `WS_TOKEN_SECRET`    | the secret from step 1 (same value as SSM) | server  |

Then add the deployed Vercel domain(s) to the authorizer allowlist and redeploy
the stack (origin check, Constitution VII):

```bash
# In infra/bin/app.ts, pass allowedOrigins to the RealtimeStack, e.g.
#   allowedOrigins: ["https://f1-dashboard.vercel.app", "https://*.vercel.app"]
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk deploy F1-Realtime
```

Deploy the frontend (push to the connected branch, or `vercel --prod`).

## 5. Verify (Definition of Done)

- [ ] Open the Vercel Production URL → page loads in < 5s.
- [ ] During a live session: timing tower + gap chart update without refresh.
      Off-session: enter a known archived `session_id`, pick a speed, **Start**
      → frames play back in order (AC-2/AC-5).
- [ ] DevTools → Network offline for ~2s → reconnects within 5s, state restored
      (AC-4). The `ConnectionStatus` badge shows reconnecting → open.
- [ ] Lighthouse: Desktop ≥ 90, Mobile ≥ 80 (AC-7).
- [ ] CloudWatch `f1-realtime` dashboard shows connections + lambda activity.
- [ ] Cost after 24h ≤ a few cents (AC-8 / Constitution IV).

## Rollback

```bash
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk destroy F1-Realtime
```

`F1-Connections` is `DESTROY` (ephemeral). The S3 archive and `F1Live` are owned
by other stacks and are untouched.
