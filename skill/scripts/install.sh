#!/usr/bin/env bash
# Vitrin installer: builds the CLI, installs a global `vitrin` command and copies the /vitrin skill into ~/.claude/skills.
# Environment: CLAUDE_SKILLS_DIR (default ~/.claude/skills), VITRIN_BIN_DIR (default: npm's global bin), VITRIN_SKIP_BUILD=1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
cp "$ROOT/skill/SKILL.md" "$SKILL_DIR/SKILL.md"
rm -rf "$SKILL_DIR/references" && cp -R "$ROOT/skill/references" "$SKILL_DIR/references"
# SKILL.md points to the Apple notes; in the installed skill they live under references/.
cp "$ROOT/docs/apple-notes.md" "$SKILL_DIR/references/apple-notes.md"
echo "✓ Skill installed: $SKILL_DIR"
echo "✓ Next: run vitrin init in your app repo, then /vitrin in Claude Code"
