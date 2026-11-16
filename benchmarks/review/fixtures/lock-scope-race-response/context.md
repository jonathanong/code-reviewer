## Other reviewers and comments (1)

- **chatgpt-codex-connector** replies.mts:5: P2 race: the parent can be archived between the archived check and the insert, so a reply can still land under an archived comment. Lock the parent row and its ancestors (`FOR UPDATE`) before the check so archiving waits for the reply.
