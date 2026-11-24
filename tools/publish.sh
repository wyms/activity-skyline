#!/bin/sh
# Publishes site/ to the gh-pages branch, which GitHub Pages serves. Pushing to main never changes the live site.
# Run from a clean main that is already pushed:  sh tools/publish.sh
set -eu
cd "$(git rev-parse --show-toplevel)"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Switch to main before publishing." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or discard local changes before publishing." >&2; exit 1; }
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push main before publishing, so the live site matches the repository." >&2; exit 1; }

node tools/check.mjs
node --test tests/*.test.cjs > /dev/null || { echo "Tests failed. Run npm test to see why. Nothing was published." >&2; exit 1; }
echo "Tests passed."

tree=$(git rev-parse "HEAD:site")
short=$(git rev-parse --short HEAD)
if parent=$(git rev-parse --verify --quiet origin/gh-pages); then
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "The live site already matches $short. Nothing to publish."
    exit 0
  fi
  commit=$(TZ=UTC git commit-tree "$tree" -p "$parent" -m "Publish $short")
else
  commit=$(TZ=UTC git commit-tree "$tree" -m "Publish $short")
fi
git push origin "$commit:refs/heads/gh-pages"
echo "Published $short. GitHub Pages updates within a minute or two."
