# is-a-tracker

A personal moderation assistant for pull requests on `is-a-dev/register`.

It detects two violations, pings you on Discord, and acts **only** when you press a button.

| Violation                                  | Button          | What the button does                                 |
| ------------------------------------------ | --------------- | ---------------------------------------------------- |
| NS records from a first-time contributor   | Close PR        | Posts the policy comment, then closes the PR         |
| `owner.email` is a GitHub no-reply address | Request Changes | Submits a review with an inline comment on that line |

One Deno process runs the scanner, the Discord bot, and the SvelteKit dashboard. They share one SQLite file.

## Setup

1. Copy the example settings: `cp .env.example .env`
2. Fill in `GITHUB_TOKEN`, `DISCORD_BOT_TOKEN`, `DISCORD_USER_ID` and `DASHBOARD_PASSWORD`
3. Install: `deno install`
4. Develop: `deno task dev`
5. Or run for real: `deno task build`, then `deno task start`

### GitHub token

- Needs **Pull requests: Read and write** on `is-a-dev/register`.
- A fine-grained token only works if the `is-a-dev` organisation lets you select the repository.
  If it does not appear in the list, use a classic token with the `public_repo` scope instead.

### Discord bot

1. Create an application at <https://discord.com/developers/applications> and add a bot.
2. Copy the bot token into `DISCORD_BOT_TOKEN`. No privileged intents are needed.
3. Invite the bot to any server you are in. Direct messages need one shared server.
4. Put your own user id in `DISCORD_USER_ID`. Only that id can press the buttons.

The bot uses the Gateway, so nothing needs to be exposed to the internet.

## Dry run

`DRY_RUN` is **on by default**. While it is on, buttons revalidate the PR and report what they
would have done, and nothing is sent to GitHub. Set `DRY_RUN=false` once you trust what you see.

## Wording

Edit `config/messages.json`. Changes apply on the next action, with no restart.

## How it stays safe

- Every action revalidates the PR at its latest commit first.
- A finding can only be claimed once, so two clicks never post twice.
- Writes to GitHub are never retried automatically.
- Statistics count successful actions only. Every attempt lands in the audit log.
- The scanner keeps a reserve of the GitHub rate limit free for your approved actions.

## Adding a rule

1. Add a module in `src/lib/server/rules/` that exports a `Rule`.
2. Register it in `src/lib/server/rules/index.ts`.
3. If it needs a new kind of action, add an executor in `src/lib/server/moderation/executors.ts`.

## Checks

```sh
deno task test
deno task check
deno task lint
```

## Deploying

The `deploy` folder is a runit service, laid out like the one in the `web` project.

- `deploy/run` starts the built app as `clove` from `/srv/clove/is-a-tracker` on port 3101.
- `deploy/log/run` sends its output to `/var/log/is-a-tracker` through `svlogd`.

The server folder needs `build/`, `node_modules/`, `config/`, `package.json` and `.env`.
It also needs a `data/` folder that `clove` can write to; the SQLite file lives there.

Set `ORIGIN` in the server's `.env` to the dashboard's public address.
