CREATE TABLE members (
  id uuid PRIMARY KEY,
  email text NOT NULL
);

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  member_id uuid REFERENCES members (id),
  email text NOT NULL,
  sent_at timestamptz NOT NULL
);

CREATE INDEX invites_member_id_idx ON invites (member_id);
