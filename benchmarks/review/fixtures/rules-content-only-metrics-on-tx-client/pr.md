# feat: record where members sign up from

`createMember` now takes the channel the member came from and stores it in `signup_events`, in the
same transaction as the member row so the two stay consistent. A failure to store the channel is
swallowed so that signup itself still succeeds.
