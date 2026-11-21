# Afterglow Arcade APIs

Backend: Supabase project **Afterglow-Accounts** (Sydney region). No additional project was created.

## Available services

- **Leaderboard API:** `POST /functions/v1/arcade-api` with `{ "action":"leaderboard", "gameId":"snake" }`.
- **Score submission:** `{ "action":"submit_score", "gameId":"snake", "score":120, "displayName":"Guest-1234", "sessionId":"<browser-session-uuid>" }`. Scores are integer-only, capped at 1,000,000,000 and rate-limited to one per game per session every 10 seconds.
- **Analytics:** `{ "action":"track_event", "eventName":"game_open", "gameId":"snake" }`. Only allowlisted event names are stored; no IP address, email, or account identifier is collected.
- **Multiplayer:** Supabase Realtime public room channels with 6-character room codes, presence and Broadcast events. This is a transport layer; each game's rules/state still need game-specific integration.
- **Progress:** `AfterglowAPI.saveProgress(gameId, data)` and `AfterglowAPI.loadProgress(gameId)` use localStorage, so guests do not need accounts.

## Browser integration

The arcade exposes `window.AfterglowAPI` to same-origin self-hosted game frames. From a self-hosted game's JavaScript:

```js
// Save a score when the game ends:
window.parent.AfterglowAPI.submitScore("snake", score).catch(console.error);

// Send and receive small real-time room events:
window.parent.AfterglowAPI.sendRoomEvent("game-state", { score, level });
window.parent.AfterglowAPI.onRoomEvent(message => {
  if (message.type === "game-state") console.log(message.data);
});
```

Only the Supabase publishable key is included in the browser. The service-role key stays inside the Edge Function.
