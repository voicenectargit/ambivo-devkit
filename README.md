# Ambivo Developer Kit

Build apps on the Ambivo API with your own coding assistant, on your own computer. The kit teaches Claude Code
the Ambivo API, screen style and sign-in. The apps it builds work with Ambivo from the start.

It is for two groups:

- **Companies building apps for themselves.** No approval needed. You install the app in your own company,
  and its custom objects count against your company's quota.
- **Development partners building apps for clients.** Ambivo must approve you before you install apps in
  other companies. To apply, write to dev-partner@ambivo.com.

The full guide, with a chart of which way suits you, is at
[ambivo.com/documentation/guides/dev-studio](https://www.ambivo.com/documentation/guides/dev-studio#choose).

There are four ways to build. We recommend Docker.

| Way | Where it runs | Use it when |
| --- | --- | --- |
| [The Docker image](#start-with-the-docker-image) | Your computer, in a container | Most of the time. Free. Dev Studio in your browser, VS Code, WebStorm or the terminal |
| [Claude Code without Docker](#or-build-without-docker) | Your computer | You already use Claude Code and Node. Free |
| [Private hosted Dev Studio](https://www.ambivo.com/documentation/guides/dev-studio#hosted) | A server for your team only, run by Ambivo | You want Ambivo to host Dev Studio for you. Paid. Coming in December 2026 |
| [Shared hosted Dev Studio](https://www.ambivo.com/documentation/guides/dev-studio#hosted) | Ambivo's shared server, in your browser | You want to try Dev Studio, or show a demo. It may be removed at any time |

## Two kinds of Ambivo app

| | App extension | Standalone app |
| --- | --- | --- |
| What it is | New record types and fields inside an Ambivo app, such as the CRM | An app of its own, with its own screens and web address |
| Who makes it | The client's admin, in the CRM: **Settings > Objects > Create** | You, with this kit or in Dev Studio |
| Where it runs | Inside the CRM. Nothing to host | On a web host you choose |
| Its data | Custom objects defined by the CRM (`schema_meta`) | Custom objects marked with your app's key (`hosting_apps`) |

This kit builds **standalone apps only**. To extend the CRM, use the CRM's Object Studio. An object is never both:
`hosting_apps` alone says it belongs to a standalone app.

## What is in it

| Folder | What it is |
| --- | --- |
| `plugins/ambivo-devkit` | The Claude Code plugin: rules by topic, the `/ambivo-new-app` command, a check after every edit, and the API descriptions |
| `plugins/ambivo-devkit/mcp` | The Ambivo sign-in and API server (`ambivo-mcp.mjs`). The plugin starts it for you. It needs only Node |
| `plugins/ambivo-devkit/starter` | The Angular starter app every new app is made from. Use it directly with Cursor, Codex or another assistant |

## Start with the Docker image

The image has Node, Chromium, this plugin and Dev Studio ready. On the first start it downloads Claude Code
from Anthropic, which takes under a minute. You need only
[Docker Desktop](https://www.docker.com/products/docker-desktop/), your sandbox email and password, and a
Claude plan or an Anthropic API key. You pay Anthropic for what Claude uses. Your apps are saved in the folder
you start it from.

**First time only: sign in.** Run this from the folder you keep your apps in:

```sh
docker run -it --rm -v ambivo-devkit-home:/home/node/.claude -v "$PWD":/work sgosain/ambivo-devkit
```

Prefer an Anthropic API key to a Claude sign-in? Add `-e ANTHROPIC_API_KEY` to each `docker run` command,
with the key set in your terminal. Claude Code and Dev Studio both use it.

It asks for your sandbox email and password, then starts Claude Code. Sign in to Claude when it asks, then
type `/exit`. The `ambivo-devkit-home` volume keeps both sign-ins. The sandbox sign-in lasts about a day.
To sign in to the sandbox again, run this in a terminal on your computer:

```sh
docker run -it --rm -v ambivo-devkit-home:/home/node/.claude sgosain/ambivo-devkit login
```

**Check that it is ready.** This lists what works and what to fix, including whether Anthropic accepts
your Claude sign-in or key:

```sh
docker run --rm -v ambivo-devkit-home:/home/node/.claude -v "$PWD":/work sgosain/ambivo-devkit status
```

Dev Studio shows the same list on the left, and starts no app until the Claude sign-in works.

**Push to GitHub (optional).** Sign in to GitHub once. It shows a code to enter at github.com/login/device:

```sh
docker run -it --rm -v ambivo-devkit-home:/home/node/.claude sgosain/ambivo-devkit github
```

Then Claude can push your app with git, and Dev Studio's **Push to GitHub** puts it on a new branch of a
repository you pick. Both use your own GitHub account.

On Windows PowerShell, use `-v "${PWD}:/work"` in place of `-v "$PWD":/work`, and type each command on one line.

### Dev Studio in your browser

```sh
docker run -d --name ambivo-devkit -p 127.0.0.1:4200:4200 -p 127.0.0.1:4300:4300 \
  -v ambivo-devkit-home:/home/node/.claude -v "$PWD":/work sgosain/ambivo-devkit
```

The first time, open Dev Studio with its link. To see it, run `docker logs ambivo-devkit` and open the line
that starts with `http://localhost:4300/?token=`. Your browser remembers it after that, and the link stays the
same. Click **New app**. Each app gets its own folder in your apps folder.
Stop it with `docker stop ambivo-devkit`, and start it again with `docker start ambivo-devkit`.

Keep `127.0.0.1` in each `-p`, so only your computer can reach Dev Studio. The secret in the link keeps
other programs out.

On your computer, Dev Studio has no Share link, no Codex and no Deploy. One app's Preview runs at a time.
Use one way at a time: stop this container before you open your apps folder in an IDE, because both keep
their sign-ins and app list in the same `ambivo-devkit-home` volume.
Delete moves the app's folder to `.devstudio-trash` in your apps folder.

### VS Code, Cursor or WebStorm

Copy the `.devcontainer` folder of this repository into your apps folder.

- **VS Code or Cursor:** install the Dev Containers extension, open your apps folder, and pick
  **Reopen in Container**.
- **WebStorm or another JetBrains IDE:** open `.devcontainer/devcontainer.json`. Click the container icon
  left of its first line, and pick **Create Dev Container and Mount Sources**. Then forward port 4300 in
  the IDE's ports list.

Open http://localhost:4300 for Dev Studio. VS Code opens it for you. To use Claude Code in the IDE's
terminal instead, run `ambivo-start` there.

### Claude Code in the terminal

```sh
docker run -it --rm -p 127.0.0.1:4200:4200 \
  -v ambivo-devkit-home:/home/node/.claude -v "$PWD":/work sgosain/ambivo-devkit
```

It starts Claude Code. Go on from step 3 of [Or build without Docker](#or-build-without-docker). Ask Claude
to start the app. If you start it yourself, run `npm start -- --host 0.0.0.0`. Then open http://localhost:4200. Is port 4200 already taken on your computer? Use
`-p 127.0.0.1:4201:4200` and open port 4201 instead.

| You want to | Do this |
| --- | --- |
| Sign in to your sandbox again | Run the `docker run ... login` command above, in a terminal on your computer |
| A shell in place of Claude Code | Add `bash` to the end of the `docker run` command |
| Dev Studio in place of Claude Code | Add `-p 127.0.0.1:4300:4300`, and add `studio` to the end of the `docker run` command |

**Update to the newest version:** run `docker pull sgosain/ambivo-devkit`. Docker keeps using the copy it
downloaded until you do.

**Build the image yourself:** clone this repository, then run
`docker build -f container/Dockerfile -t ambivo-devkit .` and use `ambivo-devkit` in place of
`sgosain/ambivo-devkit`.

## Or build without Docker

You need:


- Your Ambivo sandbox email and password. Ambivo sends you these when you join.
- Node.js 20.19 or later (`node -v`).
- Claude Code, signed in with your own Claude plan or an Anthropic API key. You pay Anthropic for what it uses.

Then:

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

The kit belongs to Ambivo, Inc. You may use and change it to build apps that use Ambivo. The starter app's own
files are under the MIT License: see `plugins/ambivo-devkit/starter/LICENSE-AMBIVO-STARTER.txt`. Its
`AGENTS.md` and `tools/` folder stay under the kit's license. You may not redistribute the kit itself
or use it to build a competing product. It is provided as is, with no warranty. You use it at your own risk. Ambivo's liability is limited as set out in LICENSE. The
full terms are in [LICENSE](LICENSE). Third-party parts keep their own licenses: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Using Ambivo's products and APIs is governed by Ambivo's
[Terms of Use](https://docs.ambivo.com/legal/terms-of-use). Ambivo is a trademark of Ambivo, Inc.
