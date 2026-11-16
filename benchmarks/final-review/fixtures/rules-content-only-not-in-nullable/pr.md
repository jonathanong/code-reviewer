# feat: list members who have not been invited

Adds `uninvitedMembers`, which returns the ids of members with no invite row, in id order and
capped at 100 per call. Invites can also be addressed by email only, so `invites.member_id` is
nullable.
