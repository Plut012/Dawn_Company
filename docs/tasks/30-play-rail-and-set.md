# 30 — Play screen: the rail, and Set

## Overview
The board is the play screen's main thing now. Two changes, agreed with the user (2026-11-21):

**1. A quieter screen.** Above the board only the round, the light and the clock; below it the selected man's
name, his chits and the lever. Everything else folds into a **rail** at the board's right edge, dim until
touched:
- a mark per player, lit when that player is ready; your supply; a pip per man (filled = has an order,
  hollow = holds, faint = down, rust = rejected or under own fire; tap a pip to pick him); a count of the
  round's lines not yet read.
- Tapping the rail opens a **drawer** over the board (the board never resizes): Standing (supply, mode,
  every player's lamp and score), Squad (the unit cards, buy-backs as before; picking a man closes it),
  Lines (what is going on now, then the round's report). A tap on the board or Escape closes it.
- A warning (a rust line: out of reach, own men under fire, rejected, signal lost) also shows over the
  board for four seconds, once per line.
- The lever's words ("Pull when set", the sentence under it) are gone; the lever and its Plan/Ready marks stay.

**2. Set.** A move or dash being aimed stays open so its route can be shaped; while it is open a tap on a
teammate's hex is a destination like any other. **Set** (an amber chit shown while aiming a move or dash),
Enter, or a second tap on the route's end closes aiming; only then does a tap on a teammate pick him.
Picking a man from a pip or a card always works. The draft is saved on every tap, as before: Set only
ends aiming.

Files: `src/client/ui/screens/play.ts`, `src/client/ui/app.css`. No change to rules, server, content,
protocol or the render kits.

## Checked
Driven in headless Chrome against a real server (two dev seats): the rail, the drawer opening and closing,
Set appearing and closing aiming, a pip picking a man; desktop 1280 × 720, phone 390 × 844 and 844 × 390,
no sideways scroll. `npm test` and `npm run typecheck` pass.

## Not checked
A real phone; taps on the map itself (route-end Set, a teammate's hex while aiming) were not driven,
only read. Old eval pages that read `.play-strip` as a button (18) now find a plain line.
