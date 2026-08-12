# Shell sessions

`shell-sessions.ts` runs shells for the browser terminal. Each session is a child process started in a validated working directory; `server/backend.ts` owns the routes and the directory validation.

- `POST /api/shell` starts a session and returns its id.
- `GET /api/shell/stream?id=` streams output as SSE, beginning with the buffered scrollback so a reopened panel shows the session as it already is.
- `POST /api/shell/input` writes raw bytes, so control characters such as `Ctrl+C` reach the shell unchanged.
- `POST /api/shell/close` terminates the shell.

The shell is wrapped in `script` to give it a pseudo terminal, which keeps prompts, colors, and line editing intact without a compiled dependency. When that wrapper is missing or refuses a piped input, the session restarts once as a plain shell and clears the failed attempt from the view.

Sessions run as the backend user and are therefore as privileged as Pi itself; the backend still listens only on `127.0.0.1`, and browsers reach it through the Hermes plugin proxy. Idle sessions close after an hour, and at most eight run at once.

Focused coverage: `test/shell-sessions.test.ts`.
