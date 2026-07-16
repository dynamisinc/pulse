# RETROFIT-NOTES.md — bringing D1 + D5 mockups onto the D7 shell

What each finished mockup improvised (COMPONENTS.md inventory) and what replaces it.
No redesign of channel content; these are container swaps.

## D1 — Pulse Social App

| Improvised (anchor) | Retrofit |
|---|---|
| Exercise banners `.xb .xbt/.xbb` | Keep as-is — D1's two-banner inset model IS the canonical participant chrome. Text becomes the shared config token (`UNCLASSIFIED // EXERCISE …`). No visual change. |
| Advisory alert bar `.abar` | Replace container with the shell alert-bar host (band treatment — D1's palette was adopted exactly, so visual change ≈ zero). Gains: chip anatomy, timestamp + Details →, emergency/info states, multi-alert stacking, collapse. Content stays D1's. |
| Nav rail + logo `.nav .logo` | STAYS — it is Pulse product nav (in-fiction), not shell. But the shell's 38px channel strip inserts between alert bar and the app frame; Pulse's rail loses nothing. Mobile: Pulse's own tabs sit inside the content region; the shell bottom tab bar is the cross-channel layer (single-channel deployments may hide it — config). |
| Identity switcher ("Posting as" chip) + me card | STAYS — in-fiction product UI (SOC-006), explicitly not shell chrome. Remove from shell inventory. |
| Missing: exercise identity for participants (divergence #5) | Resolved by design: participants never see exercise identity inside the fiction (XC-002). The compliance chrome is their only exercise signal. |

## D5 — Controller Console

| Improvised (anchor) | Retrofit |
|---|---|
| `.exbar` | Keep — adopted as the canonical staff exercise bar. Classification stays `UNCLASSIFIED // FOUO` (per-world config token). |
| `.hdr` brand lockup `.brand` | Keep — lockup format is now shell-owned: PULSE / {SURFACE NAME}. |
| `.exsw` identity badge | Keep — canonical (COR-005, static during conduct). |
| `.clocks`, `.state-pill`, `.presence` | Keep — all adopted verbatim into the staff shell frame. |
| `.hgrp` (focus toggle, pause, guarded group) | Console-specific conduct controls — these remain SURFACE controls rendered in the shell header's action slot, not shell chrome. The evaluator dashboard will put its own (fewer) controls there. |
| Missing: participant admin (COR-017), preview-as-participant (COR-041) | Add: ADMIN tool on the toolstrip (D5-016/017 extension point — slot exists already) and "Preview as participant" header button. Both designed in `Pulse Staff Shell.dc.html`. |
| Break-fiction overlay (D5-007) | The console keeps only the TRIGGER (guarded group). The overlay itself is now shell-owned (designed in D7, canonized from D5-007's language); console's local overlay markup is replaced by the shell's. |
| Tiered pause pages | Console keeps the pause CONTROL; the participant-facing pause/EndEx pages are shell-owned (in/out-of-fiction variants per CTL-023/COR-054). |
