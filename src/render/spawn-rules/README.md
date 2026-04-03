# Spawn Rules

This folder is the explicit spawn contract for the renderer: it chooses background, particle, event, and motif-effect concepts from small readable inputs instead of letting hidden fallback branches decide later.

Each active concept must carry:

- a stable ID
- a one-sentence pitch
- a one-sentence distinction
- explicit eligibility
- an explicit continuity policy
- runtime tuning that can trim or mute the concept without silently replacing it

A scene means every visual element currently built from one resolved source image, so scene-scoped spawn selection changes only when the resolved source image changes.
