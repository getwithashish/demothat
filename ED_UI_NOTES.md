# Ed AI Assistant UI Redesign — Developer Notes

This document covers the redesigned UI surfaces for **Ed**, the AI editing assistant inside DemoThat:

1. **Ed Chat Sidebar** (the "Ed ✨" tab in the inspector panel)
2. **Ed Command Palette** (opened via "Ask Ed" top bar button or Ctrl/Cmd+K)

---

## 1. Libraries Added & Rationale

| Library                             | Version              | Purpose                                                                                                                                                                                                                        |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **cmdk**                            | `^1.0.4`             | Fast, accessible, unstyled command palette primitive (`Command.Dialog`, `Command.Input`, `Command.List`, `Command.Item`, `Command.Group`). Powers the Ctrl/Cmd+K palette with fuzzy search, keyboard navigation, and grouping. |
| **motion** (`motion/react`)         | `^12.4.7`            | Spring physics animations, interruptible transitions, sliding row highlight (`layoutId="palette-highlight"`), `AnimatePresence` for step transitions, and OS `prefers-reduced-motion` integration.                             |
| **react-markdown** + **remark-gfm** | `^10.1.0` / `^4.0.1` | Renders rich text formatting in Ed's replies (code tags, lists, inline formatting) while strictly respecting theme font sizes and tokens.                                                                                      |

_Note:_ Radix UI primitives (`@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-switch`) and icons (`tabler-icons-react`) were already part of the project and were preserved.

---

## 2. Folder Structure

All Ed-specific UI code is centralized under `src/features/ed/`:

```
src/features/ed/
├── actions/
│   └── registry.ts          # Single source of truth for all Ed actions, prompts & groupings
├── hooks/
│   ├── useEdContext.ts      # Throttled (10 Hz) subscription to playhead & selected region
│   └── useReducedMotion.ts  # Detects OS prefers-reduced-motion setting
├── palette/
│   └── EdCommandPalette.tsx # Surface B: cmdk + motion command dialog
└── sidebar/
    ├── EdActionCard.tsx     # Rich action execution card (live status, steps, undo, timeline jump)
    ├── EdAvatar.tsx         # Gradient avatar with optional thinking pulse
    ├── EdComposer.tsx       # Auto-growing textarea, slash menu, streaming border, send/stop morph
    ├── EdContextChips.tsx   # Live chips (Playhead, Selection, Clip) with dismiss buttons
    ├── EdCreditsPill.tsx    # Monospace credit counter with animated transitions
    ├── EdMessageBubble.tsx  # Message thread item (User bubble, Ed text/markdown, action cards)
    ├── EdSidebar.tsx        # Surface A: sidebar shell (header, overflow menu, empty cards, log)
    ├── EdSuggestionCards.tsx# 2x2 grid empty state cards with hover lift
    └── toolMeta.ts          # Tool-to-icon and friendly label mapping
```

---

## 3. Theming & Design System Integration

- **Both Dark and Light themes fully supported**:
  - Dark: elevated panels (`#17181b`), subtle hairline dividers (`#2a2c31`), high contrast text (`#ebecee`).
  - Light: paper surfaces (`#f6f5f2`), crisp dividers (`#d6d3cc`), dark slate text (`#1d1d1b`).
- **No hardcoded color literals**: All components strictly consume the app's tokens via `var(--sa-*)` and Tailwind mappings (`bg-panel`, `bg-ctl`, `border-line`, `text-fg`, `text-muted`, `bg-accent`, `text-danger`).
- **Enforced style guardrails**:
  - Passes `src/styles/style-guardrails.test.ts` (0 color literals outside `tokens.css`, no typography below 11px floor).
  - Passes `src/styles/contrast.test.ts` (WCAG AA compliant contrast in both light and dark modes).

---

## 4. How to Add a New Ed Action Type

Adding a new action requires only **one edit** in `src/features/ed/actions/registry.ts`:

```ts
// In ED_ACTIONS:
{
  id: 'my-new-action',
  title: 'My Action Title',
  description: 'What this action accomplishes in one line',
  contextLabel: (ctx) => `My Action near ${ctx.currentTime.toFixed(1)}s`, // optional dynamic label
  icon: SparklesIcon,                                                    // Tabler icon component
  group: 'edit',                                                         // 'suggested' | 'edit' | 'emphasis' | 'style' | 'captions'
  keywords: ['keyword1', 'keyword2'],
  shortcut: '⌥X',                                                        // optional shortcut hint
  prompt: (ctx) => `Run my action at ${ctx.currentTime.toFixed(1)}s`,   // or static string prompt
}
```

The action will immediately:

1. Appear in the **Ctrl/Cmd+K command palette** under its group.
2. Be searchable via fuzzy keywords.
3. Appear in the **`/` slash command menu** in the sidebar composer.
4. Appear in the **empty state suggestion grid** if placed in `suggested` or `emphasis`.

If the action uses a custom tool execution in the backend, add a corresponding icon and label mapping in `src/features/ed/sidebar/toolMeta.ts`.

---

## 5. Known Limitations & Architecture Notes

1. **Undo Mechanism**:
   - `EdActionCard`'s "Undo" button hooks directly into the app's Zundo temporal store (`useEditorStore.temporal.getState().undo()`).
   - _Limitation_: Because DemoThat uses a single global undo history stack for timeline edits, clicking "Undo" on an older action card reverts the _most recent state change_, matching standard `Ctrl+Z` / `Cmd+Z` behavior. Per-action isolated reversal (undoing action #1 without undoing actions #2 and #3) is not supported by the underlying timeline store and is disclosed in the tooltip.
2. **Timeline Region Highlighting**:
   - Clicking "Show on timeline" moves the playhead (`currentTime`) and sets `selectedRegionId` on the affected region. It also dispatches a custom event (`ed:show-on-timeline`) containing `{ toolId, regionId, time }`.
3. **Throttled Context Updates**:
   - The playhead updates at up to 60fps during video playback. `useEdContext` throttles updates to ~10 Hz (100ms) and checks value equality to ensure the message log never re-renders during playback.

---

## 6. Verification Screenshots

All states were verified and captured in both **Dark Theme** and **Light Theme** (available in the artifacts directory):

- `01_sidebar_empty_dark.png` / `01_sidebar_empty_light.png`: Empty chat sidebar with 2x2 suggestion cards, greeting, context chips, and composer.
- `02_sidebar_running_action_dark.png` / `02_sidebar_running_action_light.png`: Running action card with animated status shimmer and live progress.
- `03_sidebar_completed_action_dark.png` / `03_sidebar_completed_action_light.png`: Completed action card with result summary, "Undo", and "Show on timeline" buttons.
- `04_sidebar_failed_action_dark.png` / `04_sidebar_failed_action_light.png`: Error state card with error explanation and "Retry" button.
- `05_sidebar_approval_state_dark.png` / `05_sidebar_approval_state_light.png`: Destructive action approval card with payload preview, "Discard", and "Apply" buttons.
- `06_palette_empty_dark.png` / `06_palette_empty_light.png`: Cmd+K command palette with rotating placeholder, categorized action groups, and keyboard navigation.
- `07_palette_filtered_dark.png` / `07_palette_filtered_light.png`: Fuzzy query filtering with live context labels (playhead timestamp).
- `08_palette_ask_ed_dark.png` / `08_palette_ask_ed_light.png`: Free-text input state offering "Ask Ed: <query>" as top selection.
