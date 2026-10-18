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
  database and the name of its database user. Treat project files as you would treat a database
  diagram: they describe your tables. Exports carry neither the connection nor the permissions,
  only the visible diagram and, for a partial read, a note saying so.
- Connections to SQL Server are always encrypted, and the server certificate is validated unless
  you explicitly tick "Trust the server certificate" for that connection.
- A diagnostic log for bug reports is kept on your computer, in
  `%LOCALAPPDATA%\com.jmanuelsoberano.schemacraft\logs`, one file per day, with at most seven
  files kept, the crash file among them. It holds versions, counts, timings, sizes and error kinds and numbers only, never a
  server, login, password, database, object name, path, SQL text or error message, and it is
  never sent anywhere; About shows the folder.
- SchemaCraft only talks to the SQL Server you point it at. It sends no telemetry and contacts no
  other network service. The only web pages it opens, in your browser and only when you ask, are
  Microsoft's WebView2 download page when the runtime is missing and the React Flow site from
  the credit in the corner of the diagram.
- Setting the `SCHEMACRAFT_REMOTE_DEBUGGING_PORT` environment variable opens a Chrome DevTools
  Protocol port on the window, reachable from this computer only, so automated tests can drive
  the built executable. Leave it unset in normal use: whoever can reach that port controls the
  window.
