# feat: record a vote as a new row

A vote used to overwrite the voter's single row. It is now appended to `votes`, and the vote that
counts is the voter's latest row. Voting twice quickly leaves two rows; the later one wins.
