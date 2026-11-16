CREATE TABLE comments (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES comments (id),
  body text NOT NULL,
  archived_at timestamptz,
  deleted_at timestamptz
);
