-- platform is 1 when hello listed tool names, as Platform does, and 0 for
-- Standalone. A row made before this column reads as Standalone until it
-- reconnects.
ALTER TABLE connection ADD COLUMN platform INTEGER NOT NULL DEFAULT 0;
