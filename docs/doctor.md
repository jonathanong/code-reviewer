# Health check

```
code-reviewer doctor [--repo owner/name | --owner LOGIN] [--clones DIR] [--offline]
```

Run it when a review seems off, or at the start of an unattended loop. It reads and runs
`--version` style probes only: it changes nothing, posts nothing, and never runs an update or
install; a fix is printed for a person to run.

Output: one line per check on stderr (`ok`, `warn` or `fail`, with `fix:` under a warn or fail),
and one JSON line on stdout, `{ok, warn, fail, checks: [{name, status, detail, fix?}]}`. It exits 0
when nothing failed, 1 otherwise. `--repo` or `--owner` scopes the machine-config problems and the
`rulePlugins` list to that repository or owner; without either, every config problem is shown and
the default rule plugins are checked. `--clones DIR` names the clones to check (else `CODE_REVIEWER_CLONE_ROOT`). `--offline` makes no network call.

| Check                     | ok                                                        | warn                                                                | fail                                       |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `node`                    | at least the `engines` minimum                            | range unreadable                                                    | older                                      |
| `git`, `gh`               | runs                                                      |                                                                     | not on PATH or does not run                |
| `github-app`              | absent (the `gh` login is used) or parses                 |                                                                     | present and does not parse                 |
| `gh-login`                | logged in, or an App is configured                        |                                                                     | not logged in                              |
| `machine-config`          | no problems                                               |                                                                     | a problem, or the directory is unreadable  |
| `rule-plugin:<name>`      | enabled at user scope and holds skills                    | installed but holds no skills                                       | not installed or not enabled at user scope |
| `plugin-freshness:<name>` | recent, and not behind its remote                         | old, behind, or the remote could not be read                        |                                            |
| `harness:claude`          | runs                                                      |                                                                     | not on PATH or does not run                |
| `harness:grok`            | runs, or absent (informational)                           |                                                                     |                                            |
| `harness:codex`           | runs, or absent (informational)                           |                                                                     |                                            |
| `harness:agy`             | runs, or absent (informational)                           |                                                                     |                                            |
| `tracker-dir`, `tmp-dir`  | writable, or missing under a writable parent              |                                                                     | not writable, not a directory              |
| `clone-root`              | unset, or a directory (with `--repo`: says if cloned)     | set but not a directory                                             |                                            |
| `clone-owner:<owner>`     |                                                           | no owner config file, or the App configured but not installed there |                                            |
| `clone-remote:<path>`     |                                                           | the clone's `origin` could not be read (failed or timed out)        |                                            |
| `clone-owners`            | every clone's owner is set up (or there is no clone root) |                                                                     |                                            |

## Clone owners

A repository that moves to another GitHub owner leaves reviews silently stopping when nothing on
the machine knows the new owner. The `clone-owners` group reads the `origin` remote of each git
checkout directly under the clone root (`--clones DIR`, else `CODE_REVIEWER_CLONE_ROOT`; nothing
runs without a root) and takes the GitHub owner from it. A remote on another host is skipped.

For each distinct owner it warns (`clone-owner:<owner>`) when:

- the machine config has no owner file (`<owner>.yaml`, `.yml`, `.json` or `.jsonc` in the config
  directory). Per-repository files do not count: without the owner file, that owner's other
  repositories run on the built-in defaults.
- an App is configured but not installed for the owner.

A clone whose `git remote get-url origin` fails or times out is a warn too
(`clone-remote:<path>`, naming the path), since its owner cannot be checked; the group never says
"all set up" while one is unreadable. It runs that command once per checkout and asks GitHub once
per distinct owner (the check `auth --owner X` makes), and not at all with `--offline` or with no
App. A warn never fails the run.

## Plugin freshness

The reviewer assumes plugin auto-update is on; this check is the safety net. For each rule plugin
it reports the installed version, or the commit for a plugin installed from git, and how long ago
its install directory last changed. It warns past `STALE_AFTER_DAYS` (14) in
`src/doctor/freshness.mts`.

Unless `--offline`, a plugin whose install records a commit and whose marketplace records a git
remote gets one `git ls-remote <remote> HEAD`, bounded by a timeout, and warns
`behind: installed X, latest Y`. A plugin that only records a version has no commit to compare,
so only its age is checked. Failing to reach the remote is a warn (`could not check`), never a
fail. The fix is `claude plugin update <name>`.

Every external call has a timeout, and independent checks run concurrently with a small bound.
