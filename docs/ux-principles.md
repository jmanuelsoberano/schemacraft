# UX principles

A modern, high-quality user interface is a product requirement of SchemaCraft, not a finishing
touch. The tool must be enjoyable to use, feel fast, look tasteful and make every task easy. This
document turns that intent into principles, a per-feature definition of done and the key flows,
so that every milestone can be checked against the same bar.

The reference style is minimal and dense, in the spirit of Linear and Figma: little chrome, careful
typography, keyboard first, and the diagram occupying almost the whole window.

## Principles

1. **The diagram is the protagonist.** Chrome is minimal and collapsible. Panels never cover the
   canvas by default, and every control that is not needed right now stays out of the way.
2. **Everything is reachable from the keyboard.** Every action has a shortcut, every shortcut is
   discoverable in tooltips and menus, focus is always visible, and a command palette (Ctrl+K)
   exposes every action by name.
3. **Immediate response.** Interaction feedback appears within 100 ms. Long operations
   (introspection, export) show real progress with a cancel option and never block the window.
   The canvas stays at 60 frames per second while panning and zooming.
4. **Errors say what happened and what to do next.** No raw exception text. A failed connection
   names the server, the cause and a concrete fix (for example: "TCP/IP may be disabled on the
   instance"). Destructive actions are the only ones that ask for confirmation.
5. **One system.** A single set of design tokens, one icon family (Lucide), one set of accessible
   primitives (Radix). Nothing is styled ad hoc.
6. **Professional density.** Base text at 13 px, identifiers and SQL types in a monospaced face,
   a 4 px spacing grid. Information is dense but breathes; nothing is cramped or wasteful.
7. **Light and dark are first-class.** Both themes come from the same tokens, follow the operating
   system by default and can be overridden. Contrast meets WCAG AA in both.
8. **Motion with purpose.** Transitions of 120 to 280 ms clarify state changes; nothing animates
   for decoration. `prefers-reduced-motion` is respected.
9. **Bilingual by design.** Every string is in the message catalogues, in English and Spanish,
   with correct plurals and no concatenated fragments.
10. **Details are the product.** Tooltips show shortcuts, cursors match the interaction, numbers
    use tabular figures, empty states explain the next step, and undo/redo covers every canvas
    change.

## Definition of done (UX)

A feature is complete only when all of the following hold:

- [ ] Every action is available through the action registry, a tooltip and a keyboard shortcut.
- [ ] The feature has loading, empty and error states, each with a next step for the user.
- [ ] It has been checked in both the light and the dark theme.
- [ ] It has been checked in English and in Spanish, with plurals and long strings.
- [ ] Keyboard navigation and focus order work without a mouse; controls have accessible names.
- [ ] Nothing shifts layout while loading; no spinner replaces content that could stay visible.
- [ ] Feedback for direct interaction appears in under 100 ms; longer work shows progress.
- [ ] Contrast of text and interactive elements meets WCAG AA on both themes.

## Key flows

### First launch

The window opens on a welcome card over the empty canvas with two clear paths: connect to SQL
Server or open a `.scraft` project. Recent projects appear here once they exist. Nothing else
competes for attention.

### Connecting to a database

A single dialog with inline validation: server and instance, authentication mode (Windows or SQL
Server), credentials only when needed, database picker filled after a successful "Test
connection", optional schema filter, encryption and certificate trust. Recent connections sit at
the top of the dialog: one click fills the form, and each entry can be removed. "Remember
password" keeps a SQL login's password in the operating system store, so a history entry or a
reopened project reconnects without typing it; the field says when a remembered password will be
used. Passwords are never stored in project files or in the history. Errors are specific and
actionable.

### Introspection

A progress indicator names the current stage (tables, columns, keys, indexes) and the counts so
far. The user can cancel. On completion the diagram appears already laid out.

### Opening and saving a project

Open, Save and Save as use the native file dialogs and the usual shortcuts. The top bar shows
the project name with a dot for unsaved changes, mirrored in the window title. Any action that
would throw unsaved changes away (opening another project, connecting, closing the window)
asks first, with the safe choice focused. A failed open or save is reported over the canvas
with the cause and the next step; a recent project whose file disappeared leaves the list.

### Working on the canvas

The entities panel lists tables and views with instant search, column counters, a visibility
toggle and "center in view" per entity, and the same context menu as the canvas. The canvas
offers three detail levels (compact, keys, full), automatic layouts (layered top-down or
left-to-right, organic, radial around a table), free dragging, multi-select with Shift, isolation
of a table with its neighbours one or two levels deep, hide, show all, collapse and expand, a
minimap and semantic zoom (cards turn compact below 40 %). Relationships use crow's foot
notation, attach at the key column and reveal their name and columns on hover. Every change is
undoable (Ctrl+Z, Ctrl+Y), and the command palette (Ctrl+K) reaches every action by name.

### Refreshing from the database

The diff is presented before it is applied: new, changed and removed tables, views, columns,
keys, indexes, constraints and relationships, with before and after values. Applying it
preserves the positions of surviving tables. A project opened from a file reconnects through
the connection dialog, prefilled from the saved connection, so only the password is typed again.

### Exporting

A single dialog chooses the format (SVG, standalone HTML, single-page PDF, PNG at 1x/2x/4x), the
detail level and the theme, and shows the size in pixels or millimetres with an estimated weight
before anything is written. It exports what is visible on the canvas. A PNG scale beyond the
renderer's limit is refused with the reason, progress names the stage and can be cancelled, and a
finished export offers to show the file in its folder. The HTML file opens in any browser with
pan, zoom, the three views, search and a detail panel per table.

## Visual language

- **Mark.** Two entity cards joined by a relationship curve on a violet-to-blue gradient
  (`assets/brand/schemacraft-icon.svg`).
- **Accent.** A violet-blue (`oklch(55% 0.19 278)` on light, lighter on dark) used sparingly for
  primary actions, selection and focus. Neutrals carry a trace of the same hue.
- **Typography.** Inter Variable for the interface, JetBrains Mono Variable for identifiers and
  SQL types. Both are bundled, so the portable executable and the exports render identically on
  any machine.
- **Spacing and shape.** 4 px grid; radii of 4, 6, 10 and 14 px; hairline borders plus soft
  shadows for elevation.
- **Motion.** 120 ms for hover and press, 180 ms for panels and menus, 280 ms for larger
  transitions, with standard and emphasized easing curves.

All values are defined once in `src/app/styles/tokens.css`.
