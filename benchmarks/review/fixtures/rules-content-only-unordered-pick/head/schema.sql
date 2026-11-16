CREATE TABLE reminders (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE INDEX reminders_due_unsent ON reminders (due_at, id) WHERE sent_at IS NULL;
