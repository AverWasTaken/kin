# Kin web

The iPhone-first PWA for Kin. React 19 + Vite + TypeScript, `motion` for springs, hand-written CSS.
Types come from the server contract in `../src/shared/api.ts` (imported as `@shared/api`).

## Develop

```sh
npm install
npm run dev          # http://localhost:5173, proxies /api (and the /api/stream socket) to 127.0.0.1:3015
```

## Mock mode

No backend needed. A simulated agent answers, reads, reacts, asks for approvals and runs background tasks.

```sh
npm run dev:mock     # same as VITE_MOCK=1
```

Or add `?mock=1` to any URL (it sticks for the tab; `?mock=0` turns it off). Extras:

- `?mock=1&fresh=1` starts at onboarding
- `?mock=1&signedout=1` starts at the sign-in screen
- `?gallery=1` (dev only) shows every avatar shape, accessory and state

Things to try in mock chat: "research …" (background task card), "email Dana …" (approval card),
"remind me …" (reminder card), "what's the weather", "check my calendar", "thanks!" (the agent reacts).
`window.__kinMock` exposes `setState`, `say` and `react` for poking at it from the console.

## Build

```sh
npm run build        # typechecks app + service worker, then writes dist/
```

The server serves `dist/` with an SPA fallback. `dist/sw.js` precaches the app and handles push
(`{title, body, url, tag?, badge?}`), notification clicks and the app badge.

## Scripts

- `npm run icons` renders `public/icons/*` from the avatar SVG (Playwright).
- `npm run shots` takes light and dark iPhone 15 screenshots of every screen in mock mode into `screenshots/`.
  Run `npx playwright install chromium` once first.

## Layout

```
src/
  lib/         api client, WebSocket stream, store (zustand), actions, color, time, push, viewport
  mock/        fixtures + simulated backend with the same interface as lib/api.ts
  components/  Avatar, Sheet, TabBar, controls, icons, chat/* (bubbles, cards, composer, menus)
  screens/     Chat, Today, Goals, Library, Profile, RunDetail, MemoryEditor, Onboarding, SignIn
  styles/      tokens, base, avatar, chat, sheets, screens, onboarding
  sw.ts        service worker (injectManifest)
```
