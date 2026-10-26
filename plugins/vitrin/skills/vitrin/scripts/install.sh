#!/usr/bin/env bash
# Vitrin installer for contributors working from a clone: builds the CLI, installs a global `vitrin` command
# that runs this checkout and copies the /vitrin skill into ~/.claude/skills.
# (Users do not need this: the Claude Code plugin installs everything, see the README.)
# Environment: CLAUDE_SKILLS_DIR (default ~/.claude/skills), VITRIN_BIN_DIR (default: npm's global bin), VITRIN_SKIP_BUILD=1.
set -euo pipefail

# This script lives in plugins/vitrin/skills/vitrin/scripts/.
SKILL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SKILL_SRC/../../../.." && pwd)"
SKILL_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/vitrin"
BIN_DIR="${VITRIN_BIN_DIR:-$(npm prefix -g)/bin}"

cd "$ROOT"
command -v pnpm >/dev/null || { echo "pnpm is required: run corepack enable"; exit 1; }
if [ "${VITRIN_SKIP_BUILD:-0}" != "1" ]; then
  pnpm install
  pnpm build
  # Playwright lives in the render package, not at the workspace root.
  pnpm --filter @vitrin/render exec playwright install chromium
fi

# Global command: a tiny launcher that runs the CLI built in this repo.
# (pnpm 11+ has no `link --global`, and npm link cannot resolve workspace:* dependencies.)
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/vitrin" <<SH
#!/bin/sh
exec node "$ROOT/packages/cli/dist/bin.js" "\$@"
SH
chmod +x "$BIN_DIR/vitrin"
echo "✓ Command installed: $BIN_DIR/vitrin"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "⚠ $BIN_DIR is not on your PATH; add this to your shell profile: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

mkdir -p "$SKILL_DIR"
cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/SKILL.md"
rm -rf "$SKILL_DIR/references" && cp -R "$SKILL_SRC/references" "$SKILL_DIR/references"
rm -rf "$SKILL_DIR/assets" && cp -R "$SKILL_SRC/assets" "$SKILL_DIR/assets"
echo "✓ Skill installed: $SKILL_DIR"
echo "✓ Next: run vitrin init in your app repo, then /vitrin in Claude Code"
