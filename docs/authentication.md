# Authentication and trust

Calls use a GitHub App when one is configured, otherwise the local `gh` login. Configure the App
with `app.json` in the config home, `${XDG_CONFIG_HOME:-$HOME/.config}/code-reviewer` (the parent of
the default `repos` directory; `CODE_REVIEWER_CONFIG_DIR` does not move it):

```json
{ "appId": "123", "privateKeyPath": "app.pem", "installationId": "456" }
```

`appId` is required (a string or number). `privateKeyPath` defaults to `app.pem` beside the file;
a relative path is resolved against the config directory, and absolute and `~/` paths are allowed.
`installationId` is optional; without it the installation is looked up per repository owner, and
with it every call uses that one installation, so set it only when one account is reviewed. The
key file must be a PEM and not readable by group or others (`chmod 600`; the check is skipped on
Windows). Any problem with the file or the key fails the command with a message naming the file.

The environment overrides the file, for CI: when `CODE_REVIEWER_APP_ID` is set, the
`CODE_REVIEWER_APP_*` variables are used (`CODE_REVIEWER_APP_PRIVATE_KEY` with PEM text, or
`CODE_REVIEWER_APP_PRIVATE_KEY_PATH`, and optionally `CODE_REVIEWER_APP_INSTALLATION_ID`) and
`app.json` is ignored. `code-reviewer auth` prints the `source` (`env` or the path of `app.json`),
never the key.

## Creating the GitHub App

A GitHub App gives the reviewer its own identity, so it can review your own pull requests as
someone else and write check runs.

1. On GitHub, open Settings, Developer settings, GitHub Apps, New GitHub App, under the account or
   organization that will own it. Give it a name (GitHub derives the App's slug, and so its
   `<slug>[bot]` login, from the name) and any homepage URL. Untick "Active" under Webhook: the
   reviewer receives no webhooks. Allow installation only on this account.
2. Grant these repository permissions and no others:

   | Permission    | Access         | Used for                                                  |
   | ------------- | -------------- | --------------------------------------------------------- |
   | Pull requests | Read and write | Reading pull requests, posting reviews, resolving threads |
   | Issues        | Read and write | Adding and removing the review labels                     |
   | Contents      | Read-only      | Reading `.code-reviewer.json`                             |
   | Checks        | Read and write | The check run, when `checkRun` is configured              |
   | Metadata      | Read-only      | Required by GitHub                                        |

3. On the App's page, note the App ID and generate a private key. Move the downloaded `.pem` to
   `app.pem` in the config home and run `chmod 600` on it. Delete the downloaded copy.
4. Install the App on the account that owns it and select the repositories it reviews. To review
   another account, allow installation on any account in step 1, install it there, and select those
   repositories.
5. Write `app.json` beside the key with the App ID, then run `code-reviewer auth`. It prints
   `"mode": "app"`, the `source`, and the `login` the reviewer trusts.

Renaming the App changes its login, so reviews it posted under the old name stop counting as its
own. Git operations still use your own clones and credentials; the App is used only for GitHub API
calls.

`claim` and `status` trust a `<!-- final-review ... -->` marker only from the identity that posts
reviews, so a review forged by someone else cannot decline a head or report approval. That
identity is the reviewer's own: the authenticated GraphQL `viewer`, or under App auth the App's
`<slug>[bot]`, looked up once per process with `GET /app` signed by the App JWT. An installation
token cannot query `viewer`, which is why the App is asked for its own slug. No variable is needed.
If the lookup fails nothing is trusted: every head is re-reviewed (status never reports approval),
and `code-reviewer auth` prints `loginError` instead of `login`.

Reviews from any other author, including one carrying a `final-review` marker, are not prior
reviews. They reach the run as other reviewers' notes with the marker stripped, and the reviewer
weighs them like any other comment.

Under local `gh` auth the reviewer posts as you, so the pull request author shares the trusted
identity when they are the same person. Use a GitHub App to separate the two.
