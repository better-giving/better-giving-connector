-- The draft's revision, which every write and delete is checked against so a
-- save never overwrites, and a publish never deletes, a draft it didn't read.
-- The store sets it on every write; the default only gives rows written before
-- this file a starting revision.
ALTER TABLE campaign_draft ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
