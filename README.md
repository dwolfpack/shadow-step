# Shadow Step — Ninja Runner

A Subway-Surfers-style endless runner built for phones: three lanes, a pseudo-3D
road, swipe controls, and a friendly ninja who dodges obstacles and gathers coins.
Plain HTML, CSS and canvas — no build step, no dependencies.

**Play it: https://dwolfpack.github.io/shadow-step/**

Everything is served straight from this repository, so running it locally is just
`npx http-server -p 8145 .` and opening `http://localhost:8145/`.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Change lane | swipe left / right | ← → or A D |
| Jump | swipe up, or tap | ↑ W or space |
| Roll under | swipe down | ↓ S or shift |
| Pause | pause button | P or Esc |
| Sound | speaker button | M |

A swipe down while airborne slams the ninja to the ground and rolls on landing.

## Gameplay

- **Obstacles.** Crates are jumped, low gates are rolled under, bamboo walls have to
  be side-stepped, and long carts can be side-stepped or landed on — their roofs
  carry a coin run.
- **Throwers.** Past 400 m (and 500 points) rival ninja appear on roadside plinths.
  Each one winds up for 0.6 s, with red chevrons marking the lane it is aiming at,
  then throws a shuriken that closes faster than the world scrolls. High stars are
  ducked with a roll, low stars are jumped, and either can be side-stepped. Slipping
  past one pays a bonus; a shield absorbs a hit and a dash shatters the star outright.
- **Power-ups.** Magnet pulls coins in, shield absorbs one hit, the sparkle doubles
  score, and dash makes the ninja briefly invincible and smashes through obstacles.
- **Three lives.** A hit costs one heart, slows the run and grants brief invulnerability.
- **Pace.** Speed climbs from 11 to 30 units/s; the gap between obstacle patterns
  scales with speed so a faster run never becomes unreadable.
- **Scenery.** The palette crossfades between four biomes every 900 m.

Best score and total coins are kept in `localStorage`. A service worker caches the
game so it runs offline, and the manifest lets it be installed to a home screen.

## Sharing scores between runners

The site is static, so there is no server to hold a leaderboard. Scores travel as
**challenge links** instead. Type a name on the game-over card and tap **Share**: on a
phone that opens the system share sheet, and elsewhere the link is copied to the
clipboard. The link carries the sender's name and best score:

```
https://dwolfpack.github.io/shadow-step/?by=Kai&best=1340
```

Whoever opens it sees a challenge banner on the title card, runs with the target in a
HUD chip, gets a toast the moment they pass it, and reads the margin on the game-over
card. The query string is stripped after it is read, so a refresh does not re-apply the
challenge, and the × on the banner clears it. Names are trimmed to 14 characters and
written as text, never as markup.

## Code layout

Every file sits at the repository root so GitHub Pages serves the game from `/`.

| File | Contents |
| --- | --- |
| `index.html` | Canvas, HUD, and the menu / pause / game-over cards |
| `style.css` | Mobile-first UI, safe-area insets, phone-shaped frame on desktop |
| `game.js` | Everything else: projection, spawner, physics, enemies, rendering, audio |
| `sw.js`, `manifest.json`, `icons/` | Offline cache and installable app metadata |

`game.js` is organised in sections: tuning constants, helpers, storage, a small
WebAudio synth, the projection, game state, input, the pattern spawner, physics and
collisions, the renderer, then the HUD and main loop.

### Level generation

`spawnPattern()` picks from six arrangements — single obstacle, two blocked lanes,
a full clearable row, a cart, a staircase, and a coin breather. Every arrangement
leaves at least one survivable line, and the spacing between them is derived from the
current speed. An automated bot that reacts to the nearest obstacle in its lane runs
for a full minute at top speed without taking a hit, including ducking and jumping the
shuriken thrown at it.

### Enemies

A thrower is an entity with a `throwZ` trigger, a windup timer and an `aimLane` locked
in the moment the windup starts, so the chevrons never lie about where the star will
go. The star itself moves at the world speed plus `starSpeed`, easing sideways from the
thrower's hand into the target lane so its path stays readable. Height decides the
answer: `starHigh` passes over a rolling ninja, `starLow` passes under a jumping one.

### Tuning

The numbers worth touching live in `CFG` at the top of `game.js`: `laneW`, `camY`,
`horizonFrac` and `focalFrac` control the camera; `gravity`, `jumpV` and `rollTime`
control the moves; `startSpeed`, `maxSpeed` and `accel` control the pace;
`enemyFrom`, `enemyScoreFrom`, `throwWindup` and `starSpeed` control the throwers.

Raising `camY` lifts the viewpoint and shows more road ahead, which also slides the
ninja down the frame; lowering `horizonFrac` by roughly the same amount puts the
character back where it was.

`window.ShadowStep` exposes the game state and the move functions for automated testing.

## Deploying

`.github/workflows/pages.yml` publishes the repository root to GitHub Pages on every
push to `main`. The service worker is network-first, so a deploy shows up on the next
load rather than waiting for a cache to expire.
