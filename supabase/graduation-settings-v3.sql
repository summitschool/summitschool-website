-- Graduation settings v3: 2026-2027 requirements, cords, and event dates from DocuSeal.
-- Run once in Supabase SQL Editor (safe to re-run).

UPDATE public.graduation_settings
SET
  dues_due_date = '2026-04-01',
  ceremony_date = '2026-05-16',
  ceremony_time = '2:00 PM',
  ceremony_location = 'Summit Church sanctuary',
  practice_date = '2026-05-15',
  practice_time = '10:00 AM',
  practice_location = 'Summit Church sanctuary',
  pictures_date = '2026-04-17',
  pictures_time = '12:00 PM',
  pictures_location = 'Summit Church',
  honor_cord_options = E'GOLD – Excellence in honors / straight A''s\nWHITE – Excellence in the arts\nSILVER – Excellence in business or scientific studies\nRED – Foreign language honors\nBLUE – National Honor Society\nGREEN – Environmental studies\nPURPLE – Excellence in music\nORANGE – Excellence in engineering and robotics\nBLUE/GOLD – Over 100 community service hours\nRED/WHITE/BLUE – Military or police academy programs',
  requirements_text = E'Graduation Details\n\nGraduation for senior students will be held on Saturday, May 16, 2026 at 2:00 PM in the Summit Church sanctuary. A small reception will follow, hosted by the senior moms.\n\n• Practice: Friday, May 15th at 10:00 AM in the sanctuary (steps, music, and expectations).\n• Arrival on Graduation Day: 12:30 PM for final walkthrough. Guests greeted at 1:30 PM. Students in places by 1:45 PM.\n\nAttire Guidelines\n\nCap and gowns are matte black with gold cords. Nothing is to be worn on top except school-approved cords and stoles. Leis are not allowed on stage during the ceremony but may be worn during the reception or personal photos. Cap decoration is allowed!\n\nSee separate cord and stole information sheet for pricing and colors.\n\nGraduation Fees & Ordering\n\nGraduation fee is due by April 1, 2026.\n• $65 per enrolled Summit Church School student\n• $85 per non-Summit student (includes cap & gown; must provide diploma in black leather case)\n\nCap & Gown Photos\n\nFriday, April 17th at 12:00 PM at Summit Church. Cost: $20 per student (includes one cap/gown pose + school pose). Please see Megan Bellew to pay (Cash App, Venmo, or exact cash).\n\nReception Information\n\nFood, drinks, and decorations will be coordinated by the senior moms. Please sign up on the provided sheet. We need volunteers for decorating. No confetti or glitter please.\n\nGuests\n\nUp to 15 guests per student are welcome in the sanctuary. Reception space is more limited. You are welcome to create your own personal graduation invitations.\n\nCommemorative T-Shirts\n\nAvailable for purchase soon ($15 for XS–XL, $18 for 2XL+). Great for practice day! Photos will be posted in the Facebook group.',
  updated_at = now()
WHERE school_year = '2026-2027';