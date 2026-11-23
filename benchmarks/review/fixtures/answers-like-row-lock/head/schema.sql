CREATE TABLE posts (
  id uuid PRIMARY KEY,
  title text NOT NULL
);

CREATE TABLE votes (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts (id),
  voter_id uuid NOT NULL,
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX votes_post_voter_created ON votes (post_id, voter_id, created_at DESC);
