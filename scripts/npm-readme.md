# @ardasnturk/vitrin

The command-line half of [Vitrin](https://github.com/ardasnturk/vitrin): it detects your app project, collects data, renders App Store and Google Play screenshots from HTML (Playwright) and App Preview videos in code (Remotion), validates everything against the store rules, shows a review gallery and uploads approved content with fastlane and the App Store Connect API.

The creative half is the `/vitrin` skill for Claude Code. The easiest way to get both is the Claude Code plugin, which installs this package on first use:

```text
/plugin marketplace add ardasnturk/vitrin
/plugin install vitrin@vitrin
```

Then open your app repository in Claude Code and type `/vitrin`.

## Using the CLI directly

Requires Node.js 22 or newer.

```bash
npm install -g @ardasnturk/vitrin
vitrin doctor   # lists missing tools; for Chromium it prints the exact `playwright install chromium` command
vitrin studio   # Vitrin Studio: the whole flow in a local web UI (127.0.0.1), with a panel that runs your Claude Code
vitrin --help
```

Documentation, the skill and the source live at <https://github.com/ardasnturk/vitrin>. MIT licensed.
