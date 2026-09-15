# Ping — Private 1-to-1 Chat

A full-stack WhatsApp-style private chat MVP built with Next.js, TypeScript, Supabase Auth, PostgreSQL, and Supabase Realtime.

## Features

- Email/password authentication
- Automatic unique Ping ID for each account
- Find another person by Ping ID
- Private 1-to-1 conversations
- Persistent message history
- Realtime incoming messages
- Read/unread state
- Read receipts
- Basic online presence via last-seen heartbeat
- Responsive desktop + mobile chat UI
- Row Level Security policies

## 1. Create Supabase project

Create a project at Supabase, then open **SQL Editor** and run `supabase.sql` from this repo.

The SQL creates the profiles, conversations, and messages tables, RLS policies, RPC functions, the new-user trigger, indexes, and adds `messages` to the `supabase_realtime` publication.

## 2. Configure Auth

In Supabase Auth settings, keep Email/Password enabled.

For local development, add your local URL to the allowed redirect URLs if your project requires it:

- `http://localhost:3000/auth/callback`

For production, add your deployed URL + `/auth/callback`.

## 3. Environment variables

Copy `.env.example` to `.env.local` and use the values from your Supabase project's Connect/API settings:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The current Supabase Next.js setup uses `@supabase/ssr` with cookie-based sessions and a root `proxy.ts` for session refresh.

## 4. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## 5. Test realtime

Create two accounts in two separate browser windows. Copy the Ping ID from the left sidebar, use the `+` button in the other account, and open the conversation. Send a message from either window.

## Project structure

```text
app/
  auth/callback/route.ts
  chat/page.tsx
  login/page.tsx
  signup/page.tsx
  globals.css
  layout.tsx
components/
  auth-forms.tsx
  chat-app.tsx
lib/supabase/
  client.ts
  server.ts
  proxy.ts
proxy.ts
supabase.sql
```

## Production notes

This is an MVP, not a WhatsApp-scale clone. The chat currently uses Supabase Postgres Changes because it is straightforward for a low-volume app. Supabase's current Realtime docs recommend Broadcast for most production realtime messaging workloads, so a higher-scale version should migrate message fan-out to Broadcast with private-channel authorization.

For a real public launch, also add rate limiting, abuse/spam controls, account deletion, message pagination, image/file storage, push notifications, stronger presence handling, and monitoring.
