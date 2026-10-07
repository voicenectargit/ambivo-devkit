<!-- ambivo-devkit container: ambivo-start rewrites this file. Remove this line to keep your own. -->
# You are in the Ambivo dev container

- Apps live in `/work`, which is a folder on the developer's own computer.
- Start an app with `npm start -- --host 0.0.0.0`. Without `--host 0.0.0.0` the developer cannot reach it.
  They open http://localhost:4200 on their own computer.
- Only port 4200 is published. Use it for the app the developer wants to see.
- Chromium is at `/usr/bin/chromium` for screenshots.
- The developer signs in to their Ambivo sandbox with `ambivo-start login` in a terminal of this container.
