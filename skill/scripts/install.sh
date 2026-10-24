#!/usr/bin/env bash
# Vitrin kurulumu: CLI'ı derler, global `vitrin` komutunu bağlar ve /vitrin skill'ini ~/.claude/skills altına kopyalar.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/vitrin"

cd "$ROOT"
command -v pnpm >/dev/null || { echo "pnpm gerekli: corepack enable"; exit 1; }
pnpm install
pnpm build
npx --yes playwright install chromium

# Global komut: pnpm global bin dizinine bağlar.
pnpm link --global --dir packages/cli || {
  echo "pnpm link başarısız; alternatif: alias vitrin='node $ROOT/packages/cli/dist/bin.js'"
}

mkdir -p "$SKILL_DIR"
cp "$ROOT/skill/SKILL.md" "$SKILL_DIR/SKILL.md"
rm -rf "$SKILL_DIR/references" && cp -R "$ROOT/skill/references" "$SKILL_DIR/references"
echo "✓ Skill kuruldu: $SKILL_DIR"
echo "✓ Uygulama reposunda: vitrin init, ardından Claude Code'da /vitrin"
