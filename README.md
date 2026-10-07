# Ambivo Developer Kit

Build apps on the Ambivo API with your own coding assistant, on your own computer. The kit gives Claude Code
the Ambivo API, the Ambivo screen style and the Ambivo sign-in, so the apps it builds work with Ambivo from
the start.

It is for Ambivo development partners. To become one, write to dev-partner@ambivo.com. Prefer to build in a
browser? Use Dev Studio instead: [ambivo.com/documentation/guides/dev-studio](https://www.ambivo.com/documentation/guides/dev-studio).

## What is in it

| Folder | What it is |
| --- | --- |
| `plugins/ambivo-devkit` | The Claude Code plugin: rules by topic, the `/ambivo-new-app` command, a check after every edit, and the API descriptions |
| `plugins/ambivo-devkit/mcp` | The Ambivo sign-in and API server (`ambivo-mcp.mjs`). The plugin starts it for you. It needs only Node |
| `plugins/ambivo-devkit/starter` | The Angular starter app every new app is made from. Use it directly with Cursor, Codex or another assistant |

## You need

- Your Ambivo sandbox email and password. Ambivo sends you these when you join.
- Node.js 20.19 or later (`node -v`).
- Claude Code, signed in with your own Claude plan or an Anthropic API key. You pay Anthropic for what it uses.

## Build an app with Claude Code

1. Add the kit and install the plugin. Type these in Claude Code:

   ```text
   /plugin marketplace add voicenectargit/ambivo-devkit
   /plugin install ambivo-devkit@ambivo
   ```

2. Sign in to your sandbox. In a terminal, find the server file, then run `login` with the path it prints:

   ```sh
   find ~/.claude/plugins -name ambivo-mcp.mjs -path '*ambivo-devkit*'
   node <path printed above> login
   ```

   Use your sandbox email and password. The sign-in lasts about a day.

3. Start the app, and answer the questions. Each one has a recommended answer.

   ```text
   /ambivo-new-app a stock count app for warehouse staff
   ```

4. Read the brief Claude writes (`docs/APP_BRIEF.md`) and reply yes. Then run the app:

   ```sh
   cd <your app folder>
   npm start
   ```

   Open http://localhost:4200 and sign in with your sandbox account.

5. Before you hand the app over, run `npm run ambivo:check`. It must finish with no errors. Then ask Claude to
   bundle the app as a zip, or to push it to your GitHub.

The app's `README.md` explains how to set it up in the company it is for, and how to put it online.

## Cursor, Codex and other assistants

Copy the `plugins/ambivo-devkit/starter` folder into a new folder, open it in your assistant, and point it at `AGENTS.md`. It asks
the same questions as `/ambivo-new-app`. If your assistant supports MCP servers, add `ambivo-mcp.mjs`. Run
`npm run ambivo:check` yourself after each change.

## Help

- API reference: [apidocs.ambivo.com](https://apidocs.ambivo.com)
- Questions: dev-partner@ambivo.com, with the app's name and what you saw

## License

Copyright (c) 2026 Ambivo, Inc. All rights reserved.

The kit is not open source. You may use and change it to build apps that use Ambivo, and include the
starter files in those apps for your organization and your clients. You may not redistribute the kit itself
or use it to build a competing product. It comes with no warranty, and Ambivo's liability is limited. The
full terms are in [LICENSE](LICENSE). Third-party parts keep their own licenses: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Using Ambivo's products and APIs is governed by Ambivo's
[Terms of Use](https://docs.ambivo.com/legal/terms-of-use). Ambivo is a trademark of Ambivo, Inc.
