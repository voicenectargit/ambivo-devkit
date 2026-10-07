---
name: ambivo-bundle
description: Package a finished Ambivo app for hand-off, as a zip or a push to the partner's own GitHub repository. Use when the user asks to bundle, package, export, download, zip, hand over or push the app, or runs /ambivo-bundle.
---

# Packaging an Ambivo app

Ambivo does not deploy partner apps. The hand-off is the source code: a zip, or a push to the
partner's own GitHub repository.

Run the bundler from the app's folder:

```sh
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-bundle.sh zip                 # writes ../<app>-<date>.zip
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-bundle.sh github <owner/repo>  # pushes to the partner's repo
```

It refuses to package when:

- `npx ng build` fails;
- the Ambivo check (`ambivo-check.mjs`) reports a problem;
- the secret scan finds something that looks like a token or key. gitleaks is used when installed;
  otherwise a built-in pattern scan runs and says so.

If the user did not say which, ask: a zip, or a push to GitHub. For GitHub, ask for `owner/repo`.

It always leaves out `node_modules`, `dist`, `.angular`, `.env*` and editor folders.

For `github`, the partner must already be signed in with `gh auth login`. The script creates the
repository as private if it does not exist, and never force-pushes. Ask the user for `owner/repo`;
never pick one yourself.

Tell the user what was packaged: the file or repository, the number of files, and anything the scan
skipped.
