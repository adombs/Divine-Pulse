# Frontend structure

The React and TypeScript application is under `frontend/src/`.

- `App.tsx` is the application shell: it coordinates the active run, app-wide data and events, navigation, and page
  selection. Keep feature presentation and feature-specific interactions in their page or feature components.
- `useBootstrap` (`useBootstrap.ts`) loads server-backed runs, units, scans, settings, and auto status, and coordinates
  run switching. Its pure `startup.ts` controller handles retryable startup and ignores stale startup completions;
  `requestGate.ts` and the units loader prevent older requests from overwriting a newly selected run.
- `useBattleSync` (`useBattleSync.ts`) owns live battle and history-recording state. Its pure `battleSync.ts`
  controller guards asynchronous battle and recording requests across run changes and active-battle transitions.
- `useEvents` (`useEvents.ts`) subscribes to the backend's `/api/events` server-sent event stream. The pure
  `eventStream.ts` module parses and dispatches events and reports connection state; browser `EventSource` handles
  reconnect attempts, and effect cleanup removes listeners and closes the stream.
- `components/` contains the dashboard and feature UI; `components/reference/` contains reference pages.
- `api.ts` owns the typed HTTP client and manually maintained server-facing types. See [API contracts](api-contracts.md).
- `nav.tsx`, `routes.ts`, `appearance.ts`, `useEvents.ts`, and `validation.ts` provide shared navigation, route,
  appearance, event-stream, and input-validation behavior.
- `ebst.ts`, `fuzzy.ts`, `filters.ts`, and `format.ts` hold shared domain-facing UI logic. Keep these rules consistent
  with the backend where the same concepts are validated or calculated.

Keep server-backed data in the API/bootstrap/synchronization flow. Browser-owned presentation preferences, such as
theme, font, and layout, are managed separately by `appearance.ts` and persisted in `localStorage`. Components
should receive the state and callbacks they need from the shell or a focused feature hook instead of duplicating
server synchronization or persistence logic.

Prefer a feature hook when a component's stateful feature behavior can be separated from rendering and reused or
tested independently. Keep the shell responsible for wiring app-wide state to features; avoid moving feature
business behavior into `App.tsx`. Keep shared types and helpers at the narrowest level that serves their consumers.

`npm test` runs the frontend's node tests (spoilers, navigation, resilience, game images, data and language, reference prose, links and crests). `npm run build` runs TypeScript project
checks and the Vite production build. Run both after frontend changes.
