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

Use a **classic** personal access token. Fine-grained tokens cannot select `is-a-dev/register`
unless the organisation allows it.

1. Open <https://github.com/settings/tokens> and choose **Tokens (classic)**.
2. Generate a new token and tick only **`public_repo`**.
3. Paste it into `GITHUB_TOKEN`.

- A classic token reaches every public repository your account can write to. The tool only
  ever calls the repository set in `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME`.
- At startup the tool checks the token and logs its account, its scopes, and whether that
  account may close pull requests on the repository.
- If the organisation enforces single sign-on, authorise the token under **Configure SSO**.

### Discord bot

1. Create an application at <https://discord.com/developers/applications> and add a bot.
2. Copy the bot token into `DISCORD_BOT_TOKEN`. No privileged intents are needed.
3. Invite the bot to any server you are in. Direct messages need one shared server.
4. Put your own user id in `DISCORD_USER_ID`. Only that id can press the buttons.

The bot uses the Gateway, so nothing needs to be exposed to the internet.

## Dry run

`DRY_RUN` is **off by default**: an approved action really closes or reviews the PR.

Set `DRY_RUN=true` to rehearse. Buttons then revalidate the PR and report what they would have
done, and nothing is sent to GitHub.

## Wording

Edit `config/messages.jp` ([JPCL](https://www.npmjs.com/package/jpcl-lang)). Changes apply on the next action, with no restart.

Once a contributor fixes a change request, the next scan dismisses that review with the rule's
`reviewDismissal` wording and marks the finding resolved.

## Unsupported CNAME targets

List hosts in `config/unsupportedCnames.jp` under `hosts`, for example
`hosts: ["vercel.app", "example.com"]`. A CNAME matches an entry or any subdomain of it.
Changes apply on the next scan. An empty list turns the rule off.

## Vercel previews behind a login

If the PR's website preview is a `vercel.app` link that redirects to `https://vercel.com/login`,
the tracker flags it. Approving it requests changes with the steps to turn off Vercel
Authentication. Redirects are only followed between Vercel's own hosts, and a link that cannot
be reached is never flagged. A PR with an open finding is rechecked whenever it updates, so the
review is dismissed once the preview loads, even without a new commit.

## Avatar

`config/avatar.png` is the dashboard favicon and the Discord bot's avatar. Replace the file to
change both. The site picks it up on the next build. The bot uploads it on its next start, and
only when the file has changed, because Discord rate-limits avatar edits.

`config/avatar.svg` is the vector source the PNG was rendered from. Discord only accepts raster
avatars, so the PNG is the file both actually use. After editing the SVG, re-render the PNG:

```
magick -background none -density 48 config/avatar.svg -resize 512x512 config/avatar.png
```

## Severity

When a PR breaks several rules, the most serious leads: NS (High), then CNAME (Medium),
then no-reply email (Low). Discord and the pending page show each finding's severity and
the other open violations on the same PR.

## How it stays safe

- Every action revalidates the PR at its latest commit first.
- A finding can only be claimed once, so two clicks never post twice.
- Writes to GitHub are never retried automatically.
- Statistics count successful actions only. Every attempt lands in the audit log.
- The scanner keeps a reserve of the GitHub rate limit free for your approved actions.

## Adding a rule

1. Add a module in `src/lib/server/rules/` that exports a `Rule`.
2. Register it in `src/lib/server/rules/index.ts`.
3. Give it a `severity` from 1 (low) to 3 (high).
4. A `requestChanges` rule needs wording in `config/messages.jp`
   (`reviewComment`, `reviewSummary` and `reviewDismissal`). Give it a `findLine` to comment
   inline; without one, the review body is `reviewComment` alone.
5. If it needs a new kind of action, add an executor in `src/lib/server/moderation/executors.ts`.

## Checks

```sh
deno task test
deno task check
deno task lint
```

## Deploying

The `deploy` folder is a runit service, laid out like the one in the `web` project.

- `deploy/run` starts the built app as `clove` from `/srv/clove/isATracker` on port 3101.
- `deploy/log/run` sends its output to `/var/log/is-a-tracker` through `svlogd`.

The server folder needs `build/`, `node_modules/`, `config/`, `package.json` and `.env`.
It also needs a `data/` folder that `clove` can write to; the SQLite file lives there.

Set `ORIGIN` in the server's `.env` to the dashboard's public address.
