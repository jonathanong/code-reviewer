## Goal

- Optimize for how a review feels to the person who receives it. Do not block or request changes unless it is necessary, and avoid noise.
- Keep posted text concise. Detail that only an agent fixing the issue needs goes in a collapsed `<details>` section under a one-line `<summary>`.

## Rule skills

- Before writing or changing code, tests, CI, or dependencies, load every installed skill whose description matches the files or topic you are about to touch (both rule skills and design skills), and follow them.
- Reviews get shared rules only from the installed plugins the machine config lists (`rulePlugins`; by default `no-mistakes-rules`, `ratchet-workflows`, `ratchet-github`, `ratchet-backend` and `ratchet-code`); nothing is copied from clones.

## no-mistakes

- When you find something to fix or improve in `no-mistakes` or its rules (a wrong or missing rule, a false positive, a confusing message), you can file an issue in `jonathanong/no-mistakes`.

## Design decisions

- A configuration problem stops the command before any work, with a message naming the file and key. A runtime problem degrades: a rate limit is retried, a failing harness gives way to the next candidate.
- A machine posts as the GitHub App or as the `gh` login, never a mix. An App that is configured and fails (bad key, no token, not installed) is a configuration problem; it never falls back to the login.
- The cost ceiling guards against a runaway run. Reaching it stops the review whole and holds it for a person; a partial review is never produced or posted. Set it well above a normal review's cost.
- Do not add special-case limits on what one configuration key or one pillar may do in a repository. A repository may disable any pillar, security included.
- Where the reviewer would otherwise have to judge whether to act, make it a setting that is off until configured. Issue filing and evidence reuse work this way.
- Use local git when there is a checkout. Call the GitHub API only for what git cannot know or what a pusher could forge, such as who made a commit.
- Review less only on facts a pusher cannot forge. An author rule (`plan.authors`) holds while every commit is that author's; a commit by anyone else returns the pull request to the normal plan.
- A follow-up on the same machine builds on that machine's last review and adds to it. Earlier evidence carries over to the verifier, and the evidence step still runs: new evidence may block or raise a question for the author.
- Rule text given to a model is quoted verbatim by section with a link to the skill, never paraphrased.
- The title, description and code of a pull request must agree. A claim the diff contradicts, such as test-only on a change that edits production code, is a finding.
- The reviewer does not report what a check this repository runs in CI already verifies (a formatter, linter, type check, AST rule). A comparison with the base branch that a script could make, such as a lowered coverage threshold, belongs in CI too. The reviewer reports what needs analysis: a missing or wrong test, why a test failed, a test that does not match the acceptance criteria. It never infers a CI result from code. It recommends the missing check or test.
- The reviewer does not inspect how CI or the test database is set up. It reads environment data only when the change makes it relevant.
- The reviewer never merges a pull request it reviews. When the loop is unsure, it holds the review and flags it to a person.
- A change to a prompt, schema or contract is recorded in the benchmark `HISTORY.md` in the same change, with the rows it makes non-comparable.
