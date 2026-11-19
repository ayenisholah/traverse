-- Every row belongs to one user, by the subject of their verified token (GR-3), and every query
-- filters on it, so it leads the index.
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  drafts jsonb NOT NULL,
  operations text NOT NULL,
  screen_map text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspaces_by_user ON workspaces (user_id, updated_at DESC);
