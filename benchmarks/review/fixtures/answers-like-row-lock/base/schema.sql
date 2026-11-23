CREATE TABLE posts (
  id uuid PRIMARY KEY,
  title text NOT NULL
);

CREATE TABLE votes (
  post_id uuid NOT NULL REFERENCES posts (id),
  voter_id uuid NOT NULL,
  value smallint NOT NULL,
  PRIMARY KEY (post_id, voter_id)
);
