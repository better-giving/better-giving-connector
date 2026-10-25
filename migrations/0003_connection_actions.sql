-- actions is the JSON array of action names hello listed for this deployment,
-- or NULL when hello didn't state them. A NULL row predates this column and is
-- read as "not stated", so every tool is offered, as before.
ALTER TABLE connection ADD COLUMN actions TEXT;
