-- A route is now worked out by whichever map service the server is set to use (Mapbox or Google), so the record of where a route came
-- from names the provider, or "estimate" when no service could answer. Older rows keep their value.
ALTER TABLE ride_destination_changes DROP CONSTRAINT ride_destination_changes_route_source_check;
ALTER TABLE ride_destination_changes
  ADD CONSTRAINT ride_destination_changes_route_source_check CHECK (route_source IN ('mapbox', 'google', 'estimate'));
