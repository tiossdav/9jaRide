-- Ratings go both ways (rider rates driver, driver rates rider) and carry an optional written comment.
-- Rows stay append-only; one rating per ride per direction.
ALTER TABLE ride_ratings DISABLE TRIGGER ride_ratings_append_only;
ALTER TABLE ride_ratings ADD COLUMN direction text NOT NULL DEFAULT 'rider_to_driver' CHECK (direction IN ('rider_to_driver','driver_to_rider'));
ALTER TABLE ride_ratings ADD COLUMN ratee_id uuid REFERENCES users(id);
ALTER TABLE ride_ratings ADD COLUMN comment text CHECK (comment IS NULL OR length(comment) <= 500);
UPDATE ride_ratings rt SET ratee_id = r.driver_id FROM rides r WHERE r.id = rt.ride_id;
ALTER TABLE ride_ratings DROP CONSTRAINT ride_ratings_pkey;
ALTER TABLE ride_ratings ADD PRIMARY KEY (ride_id, direction);
ALTER TABLE ride_ratings ENABLE TRIGGER ride_ratings_append_only;
CREATE INDEX ride_ratings_ratee ON ride_ratings (ratee_id, direction);
