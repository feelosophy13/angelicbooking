-- Clients may attach photos when they book online (inspiration pictures, a photo of their current lashes or brows). The pictures are
-- rows in visit_photos with phase 'client' and private files of kind 'visit', so they follow the appointment's own access rule.
-- This switch lets an owner turn the "Add photos" tile on the booking form off; on by default.
ALTER TABLE "businesses" ADD COLUMN "client_photos_on_booking" boolean DEFAULT true NOT NULL;
