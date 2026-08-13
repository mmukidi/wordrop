# Wordrop Analytics

Privacy-respecting, anonymous event tracking for engagement and churn analysis.

## Design Principles

- **Local-only storage**: All events stored in browser localStorage, never sent to external servers
- **Anonymous**: No user IDs, device IDs, or cross-app tracking
- **Privacy-compliant**: Aligns with Wordrop's privacy policy promise of anonymous telemetry
- **Lightweight**: Minimal overhead, ~500 events max kept in memory

## Tracked Events

### Game Lifecycle

**`game_started`** — When a game begins (daily or endless mode)
- `mode` — "daily" or "endless"
- `level` — Starting level

**`game_over`** — When a game ends (board rises and catches player)
- `final_score` — Total score
- `final_level` — Highest level reached
- `words_cleared` — Count of words cleared this run
- `longest_word` — Longest single word spelled
- `mode` — Game mode (daily/endless)

### Gameplay Events

**`word_cleared`** — Every time a player clears a word
- `word` — The word spelled
- `score` — Points earned
- `length` — Number of letters
- `rare_tiles` — Count of rare+ tiles in the word
- `is_glow_trigger` — Did this trigger a glow tile burst?

**`glow_tile_triggered`** — When a glow tile row/column detonates
- `direction` — "horizontal" or "vertical"
- `tiles_cleared` — Count of tiles in the line
- `bonus_points` — Points earned (tile values + GLOW_TILE_BURST_BONUS)

**`power_up_used`** — When player activates a power-up
- `type` — "hint", "shuffle", or "vortex"
- `cost` — Points deducted (hint: -10, vortex: -25)
- For hint: `revealed_word` — The word shown
- For shuffle: `tiles_on_board` — Board state when used
- For vortex: `tiles_cleared` — Bottom row tiles removed

## Accessing Analytics

### Browser Console (Developer Mode)

After the game loads, a `window.wordropAnalytics` object exposes:

```javascript
// Get summary stats
window.wordropAnalytics.summary()
// Returns: { total_events: N, events_by_type: {...}, date_range: {...} }

// Get last N games (default 10)
window.wordropAnalytics.recent(5)
// Returns: Array of game sessions with events

// Export all events as JSON
window.wordropAnalytics.export("json")

// Export all events as CSV (for spreadsheet analysis)
window.wordropAnalytics.export("csv")

// Get raw event list
window.wordropAnalytics.events()

// Clear all stored events
window.wordropAnalytics.clear()
```

### Example Session

```javascript
// See how many games have been played
window.wordropAnalytics.summary()
// {
//   total_events: 247,
//   events_by_type: {
//     game_started: 5,
//     word_cleared: 89,
//     game_over: 5,
//     power_up_used: 12,
//     glow_tile_triggered: 8
//   },
//   date_range: {
//     first: "2026-08-07T12:30:45.123Z",
//     last: "2026-08-07T15:22:10.456Z"
//   }
// }

// Check recent games and where they quit
window.wordropAnalytics.recent(3).forEach(game => {
  console.log(`${game.mode} game reached level ${game.final_level}, score ${game.final_score}`);
});
```

## Data Storage

Events are stored in browser localStorage at key: `wordrop_analytics_events`

- Max 500 events per device
- Oldest events pruned when limit exceeded
- Persists across sessions (survives app close)
- Cleared only via `clear()` or localStorage reset

## Privacy & Compliance

✅ **No PII**: No names, emails, or user identifiers  
✅ **No device tracking**: No device IDs or UUIDs across sessions  
✅ **No cross-app**: Events are per-device, not correlated across devices  
✅ **Offline**: Never transmitted, fully local  
✅ **User control**: Player can clear via console at any time  

This implementation satisfies the requirement for "event-level, not identity-linked" telemetry mentioned in GAP_ANALYSIS.md, and aligns with Wordrop's privacy policy.

## Use Cases

### Churn Analysis

```javascript
// Find which levels players most commonly quit at
const games = window.wordropAnalytics.recent(100);
const quitLevels = {};
games.forEach(game => {
  const level = game.final_level;
  quitLevels[level] = (quitLevels[level] || 0) + 1;
});
```

### Feature Adoption

```javascript
// How often are power-ups used?
const allEvents = window.wordropAnalytics.events();
const powerUpCount = allEvents.filter(e => e.event === "power_up_used").length;
const gameCount = allEvents.filter(e => e.event === "game_started").length;
console.log(`Power-up adoption rate: ${(powerUpCount / gameCount * 100).toFixed(1)}%`);
```

### Engagement Tracking

```javascript
// Average words per game
const games = window.wordropAnalytics.recent(50);
const avgWords = games.reduce((sum, g) => sum + (g.final_level || 0), 0) / games.length;
console.log(`Avg words cleared per game: ${avgWords.toFixed(1)}`);
```

## Future: External Integration

Current implementation is local-only. Future options (not yet built):

- **TelemetryDeck**: Privacy-first analytics (GDPR compliant, no login required)
- **PostHog**: Self-hosted or cloud, GDPR-friendly telemetry
- **Plausible**: Lightweight, privacy-centric analytics

When integrating externally, anonymize events before upload (strip any reconstructable device identity) to maintain privacy promise.
