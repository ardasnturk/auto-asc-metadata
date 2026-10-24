#!/usr/bin/env bash
# Vitrin kurulumu: CLI'ı derler, global `vitrin` komutunu kurar ve /vitrin skill'ini ~/.claude/skills altına kopyalar.
# Ortam değişkenleri: CLAUDE_SKILLS_DIR (varsayılan ~/.claude/skills), VITRIN_BIN_DIR (varsayılan: npm global bin).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/vitrin"
BIN_DIR="${VITRIN_BIN_DIR:-$(npm prefix -g)/bin}"

cd "$ROOT"
command -v pnpm >/dev/null || { echo "pnpm gerekli: corepack enable"; exit 1; }
if [ "${VITRIN_SKIP_BUILD:-0}" != "1" ]; then
  pnpm install
  pnpm build
  # Playwright lives in the render package, not at the workspace root.
  pnpm --filter @vitrin/render exec playwright install chromium
fi

# Global komut: repodaki derlenmiş CLI'ı çalıştıran küçük bir başlatıcı.
# (pnpm 11+ `link --global` desteklemiyor; npm link de workspace:* bağımlılıklarını çözemiyor.)
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/vitrin" <<SH
#!/bin/sh
exec node "$ROOT/packages/cli/dist/bin.js" "\$@"
SH
chmod +x "$BIN_DIR/vitrin"
echo "✓ Komut kuruldu: $BIN_DIR/vitrin"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "⚠ $BIN_DIR PATH'te değil; kabuk profiline ekle: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

mkdir -p "$SKILL_DIR"
cp "$ROOT/skill/SKILL.md" "$SKILL_DIR/SKILL.md"
rm -rf "$SKILL_DIR/references" && cp -R "$ROOT/skill/references" "$SKILL_DIR/references"
# SKILL.md docs/apple-notes.md'ye atıf yapar; kurulu skill'de references altında durur.
cp "$ROOT/docs/apple-notes.md" "$SKILL_DIR/references/apple-notes.md"
echo "✓ Skill kuruldu: $SKILL_DIR"
echo "✓ Uygulama reposunda: vitrin init, ardından Claude Code'da /vitrin"
