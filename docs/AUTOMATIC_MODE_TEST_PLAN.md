# Automatic mode: test plan and results (2026-09-30)

Automatic mode acts with nobody watching, so it was tested in a way that does not wait for real time.

## How it was tested
- **Virtual clock** (`src/core/virtualClock.js`, installed by `electron/testHarness.js`): the app's `new Date()` / `Date.now()` are shifted by a controllable offset, so a fire time, midnight, next day or a DST night can be reached instantly. A local control server (127.0.0.1:9333) sets/advances the clock, forces a scheduler tick, and emits the OS "resume from sleep" event.
- **Fake WhatsApp client** (`src/core/fakeWhatsapp.js`): records "sends" in memory and never contacts WhatsApp, with scriptable failures (not on WhatsApp, lookup error, send error, delay). Installed at boot with `BIRTHDAY_BOT_TEST_FAKE_WA=1`, so even the launch-time catch-up cannot reach real WhatsApp.
- **Gate**: all of it is inert unless BOTH `BIRTHDAY_BOT_TEST_CLOCK=1` and a scratch `BIRTHDAY_BOT_USER_DATA` are set. A normal install never enables it.
- Everything ran against the packaged app on a scratch data folder. Only the four consenting recipients from the contacts file were ever used. **Do not use invented phone numbers with a linked WhatsApp session**: two fictional 555-01xx numbers turned out to belong to real people and received a message during this campaign.

## Results
| ID | Scenario | Client | Result |
|---|---|---|---|
| A1 | Fire with nothing due: no browser, no History row | none needed | Pass |
| A2 | Paused: no fire, no retroactive send after unpausing, next fire tomorrow | none needed | Pass |
| A3 | Due person processed once; same-day re-fire sends nothing | fake | Pass |
| A4 | Time-zone change while armed (Kolkata -> New York) fires at the new zone's 09:15 | none needed | Pass |
| A5 | Fire inside quiet hours sends nothing; person stays due and goes out at the next run | fake | Pass |
| A6 | Belated window: 0, 1, 2 days sent (belated wording for 1-2); 3 days not | fake | Pass |
| A7 | Midnight: run at 23:58, no catch-up at 23:59, nothing at 00:05, no resend next day | fake | Pass |
| A8 | Eight consecutive days: a run each day, no duplicates, warm-up cap 8,15,23,30,38,45,53,60 | fake | Pass |
| A9 | Daily cap 1 with four due: one per day, no duplicates (see "Known limit") | fake | Pass |
| A10 | DST spring-forward (2027-03-14) and fall-back (2026-11-01): 09:15 local, exactly one fire | none needed | Pass |
| A11 | Clock jumps: forward past the fire time, 3 days forward (one fire each), backward a day (re-armed, no fire) | none needed | Pass |
| A12 | Launch catch-up: ON sends once; second launch same day sends nothing; OFF sends nothing; opened before the fire time does nothing until it passes | fake | Pass |
| A13 | Simulated wake from sleep: after the fire time exactly one catch-up run (no double fire with the 30 s poll); before it, nothing | none needed | Pass |
| A14 | A manual run is active when the automatic fire hits: fire skipped, both people messaged once | fake | Pass |
| A15 | All lookups fail: abort after 2, two rows failed (retryable), rest still due, next run delivers all 4; one not-on-WhatsApp person is recorded and not retried, others sent | fake | Pass |
| A16 | Manual-mode reminder: nothing sent, once-per-day guard set, not repeated on a second launch | fake | Pass |
| B1 | **Live unattended automatic send, real WhatsApp**: 3 due (Arradhya on time; Prajwal, Siddhesh belated), Pritam (3 days ago) not messaged; scheduled fire -> saved-session connect -> paced sends -> complete (125 s), no self-notify failure | real | Pass |

| B2 | **Live launch catch-up, real WhatsApp**: app opened after the 09:15 fire time (Automatic, catch-up ON), only Pritam due; connected from the saved session and sent exactly one message in 24 s, one History row | real | Pass |

B1 was also confirmed on the recipients' side: all 3 messages were delivered and the summary arrived on the tester's phone.

## Known limit (accepted)
With a daily cap and only the 2-day catch-up window, a person held back by the cap for more than two days is never sent (A9). With the default cap of 60 this needs more than 60 birthdays in a day, so it was accepted as low risk. A 5-day window clears the same backlog.

## Not run
- A real overnight run, and a real OS sleep / lid close (only the wake event is simulated; the OS delivering it is Electron's `powerMonitor`).
- A real system-clock change (needs a VM; the wall-clock poll, DST maths and clock jumps are covered above).
- The exact wording of the desktop toasts (the tester did not report it).
