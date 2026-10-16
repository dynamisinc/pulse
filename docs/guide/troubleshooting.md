# Troubleshooting

Answers to the problems staff most often meet before and during an exercise. Messages in quotes are
exactly what Pulse shows on screen.

**On this page**

- [A player cannot join](#a-player-cannot-join)
- [A player is stuck on the holding page](#a-player-is-stuck-on-the-holding-page)
- [A player still sees the feed after EndEx](#a-player-still-sees-the-feed-after-endex)
- [The feed is not updating](#the-feed-is-not-updating)
- [Staff cannot sign in](#staff-cannot-sign-in)
- [Cards, email and import problems](#cards-email-and-import-problems)
- [After a server restart](#after-a-server-restart)
- [Resetting a demo exercise (Dynamis staff only)](#resetting-a-demo-exercise-dynamis-staff-only)
- [I got a provider alert](#i-got-a-provider-alert)
- [Who to contact](#who-to-contact)

---

## A player cannot join

Start by finding the player on **Participants**. Use **Filter participants** to search by name or
sign-in name, then check the **Link** and **Access** columns.

### "This link isn't working any more"

The player's personal link no longer works. For security, the message never says why. The usual
causes are:

| What you see on the roster | Cause | Fix |
|---|---|---|
| **Link** is **Revoked** | Someone revoked the link. | Select **Reissue link**, then copy, print or email the new link. |
| **Access** is **Disabled** | The player was disabled. | Select **Enable**. If the link was also revoked, reissue it. |
| **Link** is **Active**, but the player has an old card or email | The link was reissued, which voided the old card. | Give the player the newest card or link. |

While you sort it out, the player can sign in with **Today's word** unless they are disabled.

### "That name or word wasn't recognized"

1. Check the player's **Sign-in name** on the roster. Players often type their persona handle (such
   as `@jane_smith`) instead of their sign-in name (such as `jsmith`).
2. Check the **Today's word** panel. If it shows **No word is set for today**, set one. See
   [Setting today's word](planner-guide.md#setting-todays-word).
3. **Was the word rotated?** After a rotation, only the new word works for new sign-ins. Players who
   were already signed in are not affected. Pulse never shows a word again after it is set, so if you
   have lost the current word, rotate to a new one and announce it.
4. Check that the player's **Access** is **Enabled**.

Capitals, accents, spaces and punctuation in the word do not matter.

### "Too many tries"

The player tried too many times in a short period. Ask them to wait a minute and try again.

The limit counts tries **per device**, so one player's mistakes do not lock out the rest of the room, even when
everyone is on the same venue Wi-Fi. If many players see this at once, contact support. It may mean the
server cannot see individual devices.

### The exercise is not open to players

Players can only sign in while the exercise is **Staged**, **Live** or **Paused**. Check the state on
**Exercise Management** or in the staff header. In **Build**, nobody can get in yet. After **EndEx**
(**Completed**), nobody can sign in at all.

### The player was signed out unexpectedly

- **It is a new day.** Player sign-ins end at midnight in the exercise time zone. The player taps
  their link again, or signs in with the new day's word.
- **Someone reissued or revoked their link, or disabled them.** All of these sign the player out
  everywhere.
- **Two players used the same browser.** A browser holds one player at a time. Opening a second
  player's link in the same browser signs the first player out, in every tab. Give each player their
  own device, or use separate browsers or private windows.

### Staff testing a player link got signed out of the staff console

This is expected. Opening a player link in a staff browser tab signs you in as that player and ends
your staff session. Test player links in a different browser or a private window.

---

## A player is stuck on the holding page

The holding page reads **"We'll be right back"** (in fiction) or **"EXERCISE PAUSED"** (out of
fiction). It appears on every player screen while the world is frozen or the exercise is paused, and
after a Freeze it clears by itself when the controller resumes. Players cannot dismiss it. If the
exercise was **paused** (header **PAUSED**) rather than frozen, resuming is not pushed to open tabs
yet, so ask players to reload.

1. **Look at the staff header.** If it shows **WORLD FROZEN** or **PAUSED**, the holding page is
   correct. A controller resumes the world from the pause control in the Controller Console. See the
   [Controller guide](controller-guide.md).
2. **If the header shows LIVE but a player still sees the holding page**, ask the player to reload
   the page. This can happen after a network drop.
3. **If the header shows ENDEX**, the exercise is over. Ask the player to reload. They then see the
   end-of-exercise page, and that is final. See the next section.

---

## A player still sees the feed after EndEx

This is expected today. EndEx does not update a tab that is already open, so the feed (or the holding
page) stays on screen until the player reloads. New AI-engine posts can still appear in it.

1. **Ask the player to reload the page, or close the tab.** A reload shows the end-of-exercise page.
2. **If new posts are still arriving**, a controller should set the engine switch to
   **ENGINE · STOPPED** and set white noise to **Off**. See
   [Ending the exercise](controller-guide.md#ending-the-exercise-endex).

---

## The feed is not updating

1. **Look for the new-posts button.** When new posts arrive while a player is reading, Pulse does not
   move the feed under them. A button such as "5 new posts" appears at the top of the feed instead.
   Tapping it shows the new posts.
2. **"Reconnecting…"** means the player's connection dropped but they are still signed in. They
   select **Try again**. If that keeps failing, they select **Sign in again** and use their link or
   today's word.
3. **Reload the page.** A refresh reconnects the live feed. The player stays signed in.
4. **Check the pause state.** If the header shows **INJECTS PAUSED** or **ENGINE PAUSED**, scripted
   or AI content is held on purpose. Players can still post.
5. **Check white noise.** If background chatter is missing, **White noise** may be **Off** in the
   Controller Console.
6. **For staff using Preview as participant:** the preview shows the feed as it was when you opened
   it. Select **Exit preview** and open it again to refresh it.

If many players have problems at the same time, check your venue's network first, then
[contact support](#who-to-contact).

---

## Staff cannot sign in

| Message | What it means | What to do |
|---|---|---|
| "Those credentials weren't recognized." | The username or secret is wrong. | Check both and try again. The secret field clears after a failed attempt. |
| "You're not assigned to this exercise. Contact your planner." | Your username and secret are correct, but you have no role on the exercise at this address. | Check that you are using the right exercise address. Ask Dynamis support to assign you. |
| "This address isn't configured for staff sign-in — check the URL your planner gave you." | The web address does not belong to an exercise. | Check the address. Staff sign-in is the exercise address followed by `/staff/login`. |

**"You need the … role to open …"**: you are signed in, but your role cannot open that screen. See
[Roles](getting-started.md#roles).

**Asked to sign in again after opening a new tab?** A staff sign-in only lasts for the tab you signed
in from.

---

## Cards, email and import problems

**"Personal links are not configured on this server."** The server has no site address to build
links from. Players can still be added and can sign in with today's word. Contact Dynamis support.

**"There are no cards to print."** None of the selected people has an active personal link. Issue or
reissue their links first.

**No Email links button.** Email is not set up for your Pulse server. Print cards or copy links
instead, or ask Dynamis support about email.

**Some emails were skipped.** People without an email address, or without an active link, are
skipped. Add an email address or issue a link, then send again.

**A roster import row failed.** Open **How the file is read** on the import panel. Common causes:

- two rows describe the same person;
- a sign-in name is already taken by someone who is not on this roster;
- a persona handle names a persona that does not exist, or one that is not an organization persona.

Fix the row and select **Validate** again.

**An MSEL import row failed or was skipped.**

- *Skipped* means the row's **Delivery Method** is not social media. This is expected.
- *Failed* usually means the **From / Source** persona does not exist in this exercise, or that the
  text is longer than 280 characters. A media file name that is not in the media library also fails
  the row.

See [Importing a Cadence MSEL](planner-guide.md#importing-a-cadence-msel-run-sheet).

---

## After a server restart

The Pulse server is sometimes restarted, for example for an update. Players see "Reconnecting…"
briefly and then carry on, still signed in. Saved data comes through a restart untouched: posts, the
roster, links, today's word, settings, personas and the run sheet.

What happens to the live run state depends on whether your server has the current update:

> **Rolling out: the pause state and clock now survive a restart.** With the current update, the
> pause tier comes back exactly as it was. For example, a frozen world stays frozen and players keep
> the holding page. The scenario clock also comes back. A running clock counts the downtime as if the
> server had never stopped, and a frozen clock stays on the same minute.

**Without the update**, a restart puts every exercise back to running, with the scenario clock reset
and no holding page. If you were frozen or paused, re-apply the pause in the Controller Console at
once, and check the scenario clock.

**In both cases, the AI engine's run settings are not restored.** After any restart, open the engine
controls in the Controller Console and check the engine state and autonomy before you carry on. See
the [Controller guide](controller-guide.md).

---

## Resetting a demo exercise (Dynamis staff only)

> This section is for Dynamis staff running the shared demo environment. Customer exercise staff
> should not run these tools. Contact support instead.

The demo environment has two maintenance scripts in the Pulse repository under `scripts/uat`:

- **Invoke-DemoReset** puts the demo exercise back to its opening state. It resets the pause tier and
  clock, turns white noise off, re-seeds the engine, archives old posts and MSEL-imported run-sheet
  items, re-seeds the opening content, and then runs the readiness check. **It is destructive:** it
  removes the demo's posts. Run it with `-WhatIf` first to see the plan without changing anything.
- **Test-DemoReady** is a read-only pre-flight check. It reports PASS, WARN or FAIL for health, the
  pause tier, the review queue, the AI provider (it expects the Fake provider), white noise, pins, the
  run sheet, media and the scenario clock. It changes nothing.

`scripts/uat/README-seed.md` has the full instructions.

---

## I got a provider alert

> This section is for the person who owns the AI provider (the address on the alert emails). It does
> not affect players directly: the engine drafts posts, and in Suggest mode staff review every one.

Pulse emails the provider owner when the AI service that writes engine drafts misbehaves. The email
subject names the rule:

- **generation errors / breaker open** (urgent): many calls to the AI service failed, or Pulse has
  stopped calling it for a while. When Pulse stops calling it, it also drops the engine to Suggest
  by itself.
- **attempts timing out** (urgent): enough calls are so slow that they time out.
- **latency warning**: calls are slower than normal but still work.
- **call-volume spend proxy**: the engine made far more calls in the last hour than a normal exercise
  hour. This counts calls, not money. For the real cost, open the **USAGE** tool in the Controller
  Console.

**First response, in the Controller Console of each running exercise:**

1. Move the engine switch to **ENGINE · SUGGEST-ONLY** or **ENGINE · STOPPED**. See
   [The engine switch (kill switch)](controller-guide.md#the-engine-switch-kill-switch).
2. If the AI service is failing or the call count keeps climbing, select **Cut to Fake** in the
   **ENGINE** panel. Pulse switches drafting to the offline generator, which does not call the AI
   service, without a restart. See [Provider](controller-guide.md#provider).
3. Tell Dynamis support (below), with the alert email and the time.

Alerts clear on their own when the problem stops. They are being set up for the shared demo
environment only, and are not switched on yet. How to silence or tune them is in `infrastructure/README.md` ("Provider
alerts"), for Dynamis staff.

---

## Who to contact

| For | Contact |
|---|---|
| Player questions on the day | Your exercise staff help point: **[to be filled in for your exercise]** |
| Staff accounts, assignments, staging an exercise, view-only codes, email setup, server problems | Dynamis support: **[support contact to be confirmed]** |
| Urgent problems during a live exercise | **[escalation contact to be confirmed]** |

When you report a problem, include the exercise name, the time (in real time), what the person was
doing, and the exact message on screen. Never send someone's personal link or today's word in a
support request.
