-- A lash map can set the right eye differently: `zones` is then the left eye and `right_zones` the right; null means both eyes match.
ALTER TABLE "lash_maps" ADD COLUMN IF NOT EXISTS "right_zones" jsonb;
