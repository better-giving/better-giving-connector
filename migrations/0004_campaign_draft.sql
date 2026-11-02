-- An operator's unpublished edit to a live campaign, kept here instead of sent
-- to the deployment. base_version is the campaign version the deployment
-- returned (digits as text), or NULL when it returned none. settings and page
-- are JSON, each NULL when that part wasn't edited; page_kind says which shape
-- page is and is NULL exactly when page is. No FK to better-auth's user table:
-- whoever deletes a user deletes its draft rows first. No secondary index: a
-- user holds one row per live campaign, and the idle sweep is a daily scan.
-- revision is set by the store on every write; a save or delete that read an
-- older one is refused, so it never overwrites or drops a draft it didn't read.
CREATE TABLE campaign_draft (
	user_id TEXT NOT NULL,
	origin TEXT NOT NULL,
	campaign_id TEXT NOT NULL,
	base_version TEXT,
	settings TEXT,
	page TEXT,
	page_kind TEXT CHECK (page_kind IN ('blocks', 'content')),
	updated_at INTEGER NOT NULL,
	revision INTEGER NOT NULL,
	PRIMARY KEY (user_id, origin, campaign_id),
	CHECK ((page IS NULL) = (page_kind IS NULL))
) STRICT;
