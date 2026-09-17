# Tecnican Service Agent Web

Phase I starts with a dependency-free browser agent that can later be wrapped by Tauri.

Open `index.html` directly or serve this directory with any static file server.

The agent uses the GLPI plugin API:

- `auth/login.php`
- `auth/me.php`
- `auth/logout.php`
- `tickets/my-queue.php`
- `events/poll.php`
- `work-sessions/active.php`
- `work-sessions/history.php`
- `work-sessions/start.php`
- `work-sessions/pause.php`
- `work-sessions/resume.php`
- `work-sessions/suspend.php`
- `work-sessions/finish.php`

Phase J.1/J.2 adds:

- queue search and filters;
- running slot usage for the three-session limit;
- active-session counters;
- elapsed time rendered from server-side accumulated seconds;
- start buttons disabled when all running slots are already used.

Phase J notifications adds:

- automatic queue synchronization every 15 seconds;
- visual alerts for new and updated tickets;
- native browser notifications when the Agent is in the background and permission is granted;
- last synchronization time in the queue header.

Phase K adds GLPI timeline integration. Finishing a session always records the description and accumulated time as a public followup, with an explicit option to create a solution and solve the ticket.

Phase L adds recent finished-session history and updates running timer displays every second without reconstructing the surrounding controls.

Queue synchronization defaults to one minute. The technician can select 30 seconds or an interval from one to five minutes; the preference is stored locally in the browser.

Phase M adds an authenticated long-poll event channel. It reconnects automatically, stores a per-GLPI cursor for missed events, and leaves the configurable queue synchronization active as fallback.

When the connected plugin exposes billing snapshots, recent history shows real time, billable time, and the calculated variable amount without changing the operational timer.

Enter the public HTTPS URL of a GLPI installation with a compatible Tecnican plugin API, for example `https://glpi.example.com`.
