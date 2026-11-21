# isATracker

A personal moderation assistant for pull requests on `is-a-dev/register` and
`free-domains/is-a.bot`. Set the list in `GITHUB_REPOS` (comma separated, `owner/name`).

The dashboard combines every repository. Use the **All / is-a.dev / is-a.bot** filter
on Overview, Pending and History to narrow that page to one repository. Lookup has its own
repository picker.

Overview (`/`), History, and Lookup are public. Overview shows moderation totals,
the 30-day chart, pending finding counts, and scanner health. Pending reviews and
moderation actions require the existing password login. Public lookups use the read token; moderation actions and their safety checks use
the maintainer token. Raw scanner errors are only included for signed-in moderators.
Signing in opens Pending; signing out returns to the public overview.
Without `DASHBOARD_PASSWORD`, moderation stays unavailable in production.

It detects the violations below, pings you on Discord, and acts **only** when you press a button.

| Violation                                                | Button          | What the button does                                                           |
| -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| NS records from a first-time contributor                 | Close PR        | Posts the policy comment, then closes the PR                                   |
| `CNAME` to an unsupported host                           | Close PR        | Explains the unsupported host, labels denied/incompatible records, then closes |
| Vercel preview redirects to the Vercel login             | Request Changes | Submits a review explaining Deployment Protection                              |
| `owner.email` is a GitHub no-reply address               | Request Changes | Submits a review with an inline comment on that line                           |
| `_vercel.www.alice.json` instead of `_vercel.alice.json` | Request Changes | Asks for the file to be renamed to the right name                              |
| `vc-domain-verify=` TXT inside `alice.json`              | Request Changes | Asks for it to move to `_vercel.alice.json`                                    |

Each pull request gets **one** Discord message and one dashboard card listing every issue on it,
with one button for all of them:

- With NS records or an unsupported CNAME on the PR, the button closes it, settling every issue.
- Unsupported CNAME closures add `status: denied` and `reason: incompatible records`.
- Otherwise it submits one review: an inline comment per issue where GitHub allows one, the
  rest in the review body. That review is dismissed once every issue in it is fixed.
- **Ignore** ignores every pending issue on the PR.

One Deno process runs the scanner, the Discord bot, and the SvelteKit dashboard. They share one SQLite file.

## Setup

1. Copy the example settings: `cp .env.example .env`
2. Fill in `READ_GITHUB_TOKEN`, `MAINTAINER_GITHUB_TOKEN`, the Discord settings and `DASHBOARD_PASSWORD`
3. Install: `deno install`
4. Develop: `deno task dev`
5. Or run for real: `deno task build`, then `deno task start`

### GitHub tokens

Use two **classic** personal access tokens from <https://github.com/settings/tokens>:

- `READ_GITHUB_TOKEN`: your alt account's token, with **no scopes** for public repository reads.
  Scanning and Lookup use this token, including lookups made while signed in.
- `MAINTAINER_GITHUB_TOKEN`: your maintainer account's token, with only **`public_repo`**.
  Comments, reviews, closures, dismissals, and action revalidation use this account.
  The review author identity is always checked using this token.

Keep both in `.env`, never in source or a commit. The alt needs no repository write access.
At startup, the tool logs each token's account and checks the maintainer's permissions on
all configured repositories. If an organisation uses SSO, authorise the maintainer token
under **Configure SSO**.

Existing `GITHUB_TOKEN` settings remain a fallback for `MAINTAINER_GITHUB_TOKEN`.
If `READ_GITHUB_TOKEN` is empty, reads use that same maintainer credential and retain the
existing quota reserve. A read-only setup can scan without a maintainer token, but cannot
perform moderation actions. An exhausted or invalid read token never falls back to the
maintainer token.

Distinct accounts have their own primary quota; multiple tokens for the same account
share that account's quota. GitHub normally allows 5,000 authenticated REST requests per
hour per account, with tighter search and secondary limits. The tool tracks response
headers and pauses when throttled; it does not rotate tokens to evade a limit.
See [GitHub's rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

To check more often, set `POLL_INTERVAL_SECONDS=30` in `.env` and restart. The default
remains 120 seconds, and the minimum is 30. Each cycle waits this interval after its work
finishes; rate-limit backoff can extend the wait. Faster polling does not increase GitHub's
quota, and large scans or frequent public lookups can still exhaust the read account.

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
`{service}` in the NS close comment becomes the repository's service name, such as `is-a.bot`.

Once a contributor fixes a change request, the next scan dismisses that review with the rule's
`reviewDismissal` wording and marks the finding resolved.

## Unsupported CNAME targets

List hosts in `config/unsupportedCnames.jp` under `hosts`, for example
`hosts: ["vercel.app", "example.com"]`. A CNAME matches an entry or any subdomain of it.
Changes apply on the next scan. An empty list turns the rule off. Approving a finding posts
a short unsupported-host explanation, adds `status: denied` and `reason: incompatible records`,
and closes the PR instead of requesting changes.

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
- Scan and lookup traffic uses the read credential; moderation uses the maintainer credential.
- When both roles share one credential, scanning preserves a reserve for approved actions.

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
- `deploy/log/run` sends its output to `/var/log/isATracker` through `svlogd`.

The server folder needs `build/`, `node_modules/`, `config/`, `package.json` and `.env`.
It also needs a `data/` folder that `clove` can write to; the SQLite file lives there.

Set `ORIGIN` in the server's `.env` to the dashboard's public address.

### Updating

Run this once in `/srv/clove/isATracker`, so every `git pull` rebuilds the app:

```sh
git config core.hooksPath deploy/hooks
```

After that, `git pull` is the whole deploy. The hook installs dependencies and runs the build,
and `deno run --watch` restarts the service when `build/` changes. The dashboard is down for
the few seconds the build takes to write `build/`. A build that fails to compile leaves the old
one running.
