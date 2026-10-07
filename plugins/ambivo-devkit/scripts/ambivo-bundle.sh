#!/usr/bin/env bash
# Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
# Package an Ambivo app: build, check, scan for secrets, then zip or push to GitHub.
#   ambivo-bundle.sh zip
#   ambivo-bundle.sh github <owner/repo>
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-}"
repo="${2:-}"

die() { echo "ambivo-bundle: $*" >&2; exit 1; }

# Find the project root (made from the Ambivo starter).
root="$PWD"
while [ ! -f "$root/src/ambivo/SYNCED_FROM_NX.json" ]; do
  [ "$root" = "/" ] && die "run this inside an app made from the Ambivo starter"
  root="$(dirname "$root")"
done
cd "$root"
app="$(basename "$root")"

case "$mode" in
  zip) ;;
  github) [ -n "$repo" ] || die "usage: ambivo-bundle.sh github <owner/repo>" ;;
  *) die "usage: ambivo-bundle.sh zip | github <owner/repo>" ;;
esac

EXCLUDES=(node_modules dist .angular .git .idea .vscode .DS_Store coverage .ambivo)

echo "1/3 Building..."
npx ng build >/tmp/ambivo-bundle-build.log 2>&1 || { tail -30 /tmp/ambivo-bundle-build.log; die "the build failed; fix it first"; }

echo "2/3 Checking Ambivo rules..."
node "$here/ambivo-check.mjs" . || die "the Ambivo check found errors; fix them first"

# Stage exactly what will be shipped, then scan and package that copy.
stage="$(mktemp -d)/$app"
mkdir -p "$stage"
rsync -a $(printf -- "--exclude=%s " "${EXCLUDES[@]}") --exclude='.env*' --exclude='*.zip' ./ "$stage/"

echo "3/3 Scanning for secrets..."
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-git --source "$stage" --redact --no-banner >/tmp/ambivo-bundle-leaks.log 2>&1 \
    || { cat /tmp/ambivo-bundle-leaks.log; die "gitleaks found something that looks like a secret"; }
  echo "    gitleaks: clean"
else
  echo "    gitleaks is not installed; using the built-in pattern scan"
  patterns='AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|xox[abposr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  hits="$(grep -rEnI "$patterns" "$stage" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "$hits" | sed "s|$stage/||" | cut -c1-160
    die "found something that looks like a secret"
  fi
  echo "    pattern scan: clean"
fi

if [ "$mode" = "zip" ]; then
  out="$(dirname "$root")/${app}-$(date +%Y%m%d-%H%M).zip"
  (cd "$(dirname "$stage")" && zip -rq "$out" "$app")
  count="$(find "$stage" -type f | wc -l | tr -d ' ')"
  echo "Wrote $out ($count files)."
  exit 0
fi

# GitHub
command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
gh auth status >/dev/null 2>&1 || die "sign in to GitHub first: gh auth login"

[ -d .git ] || git init -q -b main
if ! grep -qx "node_modules/" .gitignore 2>/dev/null; then
  printf '%s\n' "node_modules/" "dist/" ".angular/" ".env*" ".DS_Store" >> .gitignore
fi
# The sandbox sample data list stays on the developer's computer.
grep -qE '^/?\.ambivo/?$' .gitignore 2>/dev/null || printf '%s\n' ".ambivo/" >> .gitignore
if git remote get-url origin >/dev/null 2>&1; then
  current="$(git remote get-url origin)"
  case "$current" in
    *"$repo"|*"$repo.git") ;;
    *) die "origin already points at $current; refusing to change it" ;;
  esac
else
  if ! gh repo view "$repo" >/dev/null 2>&1; then
    gh repo create "$repo" --private >/dev/null || die "could not create $repo"
    echo "Created private repository $repo"
  fi
  git remote add origin "https://github.com/$repo.git"
fi

git add -A
if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -qm "Ambivo app: $app"
fi
git push -u origin HEAD || die "push failed (this script never force-pushes)"
echo "Pushed to https://github.com/$repo"
