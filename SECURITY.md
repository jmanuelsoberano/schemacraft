# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability
reporting: on the repository page, open the Security tab and choose "Report a vulnerability".
You will get an acknowledgement within a week, and a fix or a mitigation plan as soon as the
problem is confirmed.

## What SchemaCraft does with your data

- Connection passwords live in memory for the session. With "Remember password" ticked they are
  stored in the Windows Credential Manager, never in any file written by SchemaCraft.
- `.scraft` project files contain the schema snapshot and the connection without its password.
  Since 1.1 the snapshot also records what the login could see: its permissions in that
  database and the name of its database user. Since 1.2, reading procedures, functions and
  triggers and saving module code are on by default; the connection dialog offers separate
  switches for both. Module code includes view definitions and is business logic: it may contain
  credentials or any other text its authors wrote. Treat a project that saves code as database
  source code. Turn off "Save their code in the project" to keep object metadata without SQL
  texts; applying a refresh with it off removes previously saved module texts. Exports carry
  neither module code, the connection nor the permissions, only the visible diagram and, for a
  partial read, a note saying so.
- SVG, PDF and PNG include trigger counts and a legend; HTML also includes freshly read trigger
  names, events and states for the visible parents and the recorded settings of visible views.
  Module definitions and carried code are excluded. Procedures and functions are not exported
  as objects, although their names can occur in exported CHECK and DEFAULT expressions. These
  existing table expressions remain part of the schema details; they are not module source.
- A code read that fails, times out or sees fewer objects or texts keeps previously saved code
  that it cannot check, with its last-read date. A permission change does not erase a local
  copy. Turning off the relevant read option or removing a schema from the selection is an
  explicit exclusion and does not keep that code.
- Connections to SQL Server are always encrypted, and the server certificate is validated unless
  you explicitly tick "Trust the server certificate" for that connection.
- A diagnostic log for bug reports is kept on your computer, in
  `%LOCALAPPDATA%\com.jmanuelsoberano.schemacraft\logs`, one file per day, with at most seven
  files kept, the crash file among them. It holds versions, counts, timings, sizes and error kinds and numbers only, never a
  server, login, password, database, object name, path, SQL text or error message, and it is
  never sent anywhere; About shows the folder.
- In builds with the unreleased support feature, the user can preview and save a diagnostic
  `.txt` file containing application/runtime information and up to seven recognized local log
  files. No project, preferences, connection history or stored credentials are read. Saving
  writes the exact preview, without collecting new content. The user reviews and attaches that
  file manually if they choose to report a bug. Reports are public; vulnerability reports
  belong in the private channel above. Nothing is uploaded automatically.
- SchemaCraft only talks to the SQL Server you point it at. It sends no telemetry and contacts no
  other network service. The only web pages it opens, in your browser and only when you ask, are
  Microsoft's WebView2 download page when the runtime is missing and the React Flow site from
  the credit in the corner of the diagram. The unreleased support feature can also open the
  project's public GitHub issue form or security policy, only on an explicit user action. The
  issue URL contains the application version, never diagnostic contents or a local file path.
- Setting the `SCHEMACRAFT_REMOTE_DEBUGGING_PORT` environment variable opens a Chrome DevTools
  Protocol port on the window, reachable from this computer only, so automated tests can drive
  the built executable. Leave it unset in normal use: whoever can reach that port controls the
  window.
