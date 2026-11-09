---
inclusion: fileMatch
fileMatchPattern: "apps/**"
---
# Design: Necromancy with a purpose

Spooky theme must always explain state, never only decorate.

## Tokens
- Background `#0B0F0C`, surface `#141A16`, text `#E6F2E9`, muted `#8FA396`
- Soul green (alive / success) `#39FF88`, ember (sending) `#FFB347`, blood (error) `#FF4D5E`
- Font: system UI for body, a single display font for headings
- Radius 14, spacing scale 4/8/12/16/24/32

## States
- ALIVE: green pulsing heartbeat line, pulse on each SMS received
- SLEEPING: grey flat line, explain why (no permission, battery saver, no signal)
- SENDING: ember glow

## Accessibility
- Contrast at least 4.5:1, text min 16px, respects reduced motion, every icon has a label.
