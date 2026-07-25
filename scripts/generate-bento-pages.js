/**
 * Generate all bento fear-of-* page packs from a shared body template + catalog.
 * Run: node scripts/generate-bento-pages.js && node scripts/build-bento.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BENTO = path.join(ROOT, 'bento');
const PAGES = path.join(BENTO, 'pages');
const PUBLIC = path.join(ROOT, 'public');

/** Shared ending for SEO titles when catalog omits a custom title. */
function deriveHeroTag(fearShort, problemH2) {
  if (problemH2) {
    return problemH2
      .replace(/^Don't let /i, 'Stop letting ')
      .replace(/^Don’t let /i, 'Stop letting ');
  }
  return 'Stop letting ' + fearShort + ' keep you grounded';
}

function defaultTitle(label) {
  return `${label} — Relief in One Session | PhobiaFree.life`;
}

/**
 * Catalog: latinSlug is the old medical URL; slug is the new fear-of-* path;
 * image is the short english filename under public/<slug>/img/
 */
const PHOBIAS = [
  {
    latin: 'aerophobia',
    slug: 'fear-of-flying',
    image: 'flying.png',
    label: 'Fear of Flying',
    fearShort: 'fear of flying',
    title: 'Fear of Flying — Fly Calm in One Session | PhobiaFree.life',
    description:
      'Overcome fear of flying in one peaceful Zoom session. No trance, no exposure, no long-term therapy. Certified clinical hypnotherapist.',
    heroH1: 'Board the plane. Calm and free. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of flying shrink your map',
    heroTag: 'Stop letting fear of flying keep you grounded',
    problemP:
      'Millions route their lives around airports — the 14-hour drives, the cruise instead of the flight, the destinations quietly crossed off the list. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote:
      'You are someone who books the flight without a second thought — the window seat, the long haul, the trip of a lifetime. That person already exists inside you.',
    externalH3: 'The booking, the gate, the cabin',
    externalP:
      'Anxiety weeks before the trip. Racing heart at the gate. Turbulence that feels like an emergency — or refusing to board at all.',
    internalH3: 'The quiet cost of explaining',
    internalP:
      'Explaining, again, why you can’t come. Knowing the statistics by heart and feeling the fear anyway.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Weddings missed. Family across the country. Places you stopped letting yourself imagine.',
    reliefP:
      'Many clients feel a shift the same day. Book the flight. Take the window seat. Watch the clouds instead of the clock.',
    cost1H3: 'Another year grounded',
    cost1P: 'The destination you keep saying you’ll visit someday. The reunion you joined by video call.',
    cost2H3: 'The map keeps shrinking',
    cost2P:
      'Each trip declined makes the next one easier to decline. The world quietly reduces to driving distance.',
    cost3H3: 'More of the same results',
    cost3P:
      'If white-knuckling and pre-flight drinks haven’t fixed it by now, they won’t fix it next trip either.',
    ctaH2: 'Your next trip is one session away',
  },
  {
    latin: 'acrophobia',
    slug: 'fear-of-heights',
    image: 'heights.png',
    label: 'Fear of Heights',
    fearShort: 'fear of heights',
    title: 'Fear of Heights — Stand Tall in One Session | PhobiaFree.life',
    description:
      'Overcome fear of heights in one peaceful Zoom session. No trance, no exposure, no long-term therapy.',
    heroH1: 'Stand at the edge. Calm and steady. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of heights keep you grounded',
    heroTag: 'Stop letting fear of heights keep you grounded',
    problemP:
      'Lives get routed around heights — balconies avoided, hikes turned back, ladders refused — while the view stays out of reach. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote:
      'You are someone who stands at the edge with ease — calm, steady, free. That person already exists inside you.',
    externalH3: 'The railing, the glass, the edge',
    externalP:
      'Dizziness at a railing. A grip that will not loosen. Ladders, glass floors, and high floors that feel impossible.',
    internalH3: 'The quiet cost of explaining',
    internalP: 'Explaining why you stayed downstairs. Knowing you are safe — and feeling the panic anyway.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Views skipped. Climbing trips declined. Spaces you stopped letting yourself imagine.',
    reliefP:
      'Many clients feel a shift the same day. Take the balcony. Ride the glass elevator. Look out without looking for an exit.',
    cost1H3: 'Another year looking away',
    cost1P: 'The viewpoint you keep saying you’ll visit someday — from the parking lot.',
    cost2H3: 'The map keeps shrinking',
    cost2P: 'Each high place declined makes the next one easier to decline.',
    cost3H3: 'More of the same results',
    cost3P: 'If gripping the railing harder hasn’t fixed it by now, it won’t next time either.',
    ctaH2: 'Your next view is one session away',
  },
  {
    latin: 'aquaphobia',
    slug: 'fear-of-water',
    image: 'water.png',
    label: 'Fear of Water',
    fearShort: 'fear of water',
    title: 'Fear of Water — Feel at Ease in One Session | PhobiaFree.life',
    description: 'Overcome fear of water in one peaceful Zoom session. No trance, no exposure.',
    heroH1: 'Get in the water. Calm and easy. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of water keep you on the shore',
    heroTag: 'Stop letting fear of water keep you on the shore',
    problemP:
      'Pool parties from a chair, beach days on the sand only, boat invites declined — while others dive in. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote: 'You are someone who eases into the water without a second thought. That person already exists inside you.',
    externalH3: 'The shore, the pool, the deep end',
    externalP: 'Chest tight at the water’s edge. Panic at the deep end — or refusing to get in at all.',
    internalH3: 'The quiet cost of explaining',
    internalP: 'Explaining why you won’t swim. Knowing others do it easily and feeling stuck anyway.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Vacations reshaped. Family pool days missed. Places you stopped letting yourself imagine.',
    reliefP: 'Many clients feel a shift the same day. Step in. Float. Enjoy the water on your terms.',
    cost1H3: 'Another summer on the edge',
    cost1P: 'The swim you keep saying you’ll try someday.',
    cost2H3: 'The map keeps shrinking',
    cost2P: 'Each invite declined makes the next one easier to decline.',
    cost3H3: 'More of the same results',
    cost3P: 'If white-knuckling the shallow end hasn’t fixed it, it won’t next summer either.',
    ctaH2: 'Your next swim is one session away',
  },
  {
    latin: 'amaxophobia',
    slug: 'fear-of-driving',
    image: 'driving.png',
    label: 'Fear of Driving',
    fearShort: 'fear of driving',
    title: 'Fear of Driving — Take the Wheel in One Session | PhobiaFree.life',
    description: 'Overcome fear of driving in one peaceful Zoom session.',
    heroH1: 'Take the wheel. Calm and confident. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of driving shrink your world',
    heroTag: 'Stop letting fear of driving shrink your world',
    problemP:
      'Highways avoided, bridges rerouted, rides begged from others — independence quietly slips away. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote: 'You are someone who drives calmly wherever you need to go. That person already exists inside you.',
    externalH3: 'The merge, the bridge, the highway',
    externalP: 'White knuckles on the wheel. Panic before merging — or handing off the keys entirely.',
    internalH3: 'The quiet cost of explaining',
    internalP: 'Asking for a ride again. Knowing the route and feeling the fear anyway.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Jobs limited. Trips skipped. Independence you stopped letting yourself imagine.',
    reliefP: 'Many clients feel a shift the same day. Start the car. Take the on-ramp. Drive on your terms.',
    cost1H3: 'Another year dependent',
    cost1P: 'The errand you keep arranging around someone else’s schedule.',
    cost2H3: 'The map keeps shrinking',
    cost2P: 'Each route avoided makes the next one easier to avoid.',
    cost3H3: 'More of the same results',
    cost3P: 'If white-knuckling hasn’t fixed it by now, it won’t next drive either.',
    ctaH2: 'Your next drive is one session away',
  },
  {
    latin: 'claustrophobia',
    slug: 'fear-of-enclosed-spaces',
    image: 'enclosed-spaces.png',
    label: 'Fear of Enclosed Spaces',
    fearShort: 'fear of enclosed spaces',
    title: 'Fear of Enclosed Spaces — Feel at Ease in One Session | PhobiaFree.life',
    description: 'Overcome claustrophobia / fear of enclosed spaces in one peaceful Zoom session.',
    heroH1: 'Step inside. Calm and at ease. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of enclosed spaces box you in',
    heroTag: 'Stop letting fear of enclosed spaces box you in',
    problemP:
      'Stairs over elevators, aisle-only seats, postponed scans — always scanning for the exit. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote: 'You are someone who steps into an elevator without a second thought. That person already exists inside you.',
    externalH3: 'The elevator, the MRI, the small room',
    externalP: 'Doors close and the panic rises. Elevators, planes, and tight rooms that feel impossible.',
    internalH3: 'The quiet cost of explaining',
    internalP: 'Taking twenty flights of stairs. Knowing you are safe — and feeling trapped anyway.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Appointments delayed. Travel restricted. Spaces you stopped letting yourself enter.',
    reliefP: 'Many clients feel a shift the same day. Ride the elevator. Sit mid-row. Feel at ease inside.',
    cost1H3: 'Another year taking the stairs',
    cost1P: 'The scan or flight you keep postponing.',
    cost2H3: 'The map keeps shrinking',
    cost2P: 'Each enclosed space avoided makes the next one harder.',
    cost3H3: 'More of the same results',
    cost3P: 'If counting exits hasn’t fixed it by now, it won’t next time either.',
    ctaH2: 'Your next step inside is one session away',
  },
  {
    latin: 'glossophobia',
    slug: 'fear-of-public-speaking',
    image: 'public-speaking.png',
    label: 'Fear of Public Speaking',
    fearShort: 'fear of public speaking',
    title: 'Fear of Public Speaking — Speak with Confidence in One Session | PhobiaFree.life',
    description: 'Overcome fear of public speaking in one peaceful Zoom session.',
    heroH1: 'Take the stage. Calm and confident. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of speaking hold you back',
    heroTag: 'Stop letting fear of public speaking hold you back',
    problemP:
      'Promotions skipped, toasts handed off, meetings stayed silent — the words stuck. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote: 'You are someone who speaks clearly when it matters. That person already exists inside you.',
    externalH3: 'The mic, the room, the eyes',
    externalP: 'Shaking voice. Dodged presentations. A racing heart the moment you stand up.',
    internalH3: 'The quiet cost of explaining',
    internalP: 'Knowing your material and still panicking. Letting someone else take the credit.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Careers slowed. Moments missed. Stages you stopped letting yourself claim.',
    reliefP: 'Many clients feel a shift the same day. Open the meeting. Give the toast. Own the room.',
    cost1H3: 'Another year staying quiet',
    cost1P: 'The presentation you keep handing to someone else.',
    cost2H3: 'Opportunities pass by',
    cost2P: 'Each speaking chance declined makes the next one easier to decline.',
    cost3H3: 'More of the same results',
    cost3P: 'If memorizing harder hasn’t fixed it, it won’t next time either.',
    ctaH2: 'Your next talk is one session away',
  },
  {
    latin: 'agoraphobia',
    slug: 'fear-of-open-spaces',
    image: 'open-spaces.png',
    label: 'Fear of Open Spaces',
    fearShort: 'fear of open spaces',
    title: 'Fear of Open Spaces — Step Out with Ease in One Session | PhobiaFree.life',
    description: 'Overcome agoraphobia / fear of open spaces in one peaceful Zoom session.',
    heroH1: 'Step out the door. Calm and at ease. Finally.',
    heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2: 'Don’t let a fear of open spaces keep you home',
    heroTag: 'Stop letting fear of open spaces keep you home',
    problemP:
      'Stores, events, and trips avoided — the world narrows to a few safe walls. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    quote: 'You are someone who moves through open spaces with ease. That person already exists inside you.',
    externalH3: 'The parking lot, the square, the store',
    externalP: 'Panic in open or crowded places. Staying near home because leaving feels unsafe.',
    internalH3: 'The quiet cost of explaining',
    internalP: 'Dreading leaving before you even start. Feeling stuck when others come and go freely.',
    deeperH3: 'A world fenced by one fear',
    deeperP: 'Errands delayed. Life postponed. Places you stopped letting yourself reach.',
    reliefP: 'Many clients feel a shift the same day. Walk outside. Enter the store. Move freely again.',
    cost1H3: 'Another year staying in',
    cost1P: 'The outing you keep promising yourself for later.',
    cost2H3: 'The map keeps shrinking',
    cost2P: 'Each place avoided makes the next one feel farther.',
    cost3H3: 'More of the same results',
    cost3P: 'If waiting it out hasn’t fixed it by now, it won’t next week either.',
    ctaH2: 'Your next step out is one session away',
  },
];

// Append remaining phobias with generated-but-solid copy from short fields
const MORE = [
  ['arachnophobia', 'fear-of-spiders', 'spiders.png', 'Fear of Spiders', 'fear of spiders',
    'See the spider. Calm and steady. Finally.',
    'Don’t let a fear of spiders run your day',
    'Rooms, basements, and camping skipped — one small creature keeps the upper hand. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays calm when a spider appears. That person already exists inside you.',
    'The corner, the web, the sudden movement', 'A jolt at movement in the corner. Fleeing a room — or the house.',
    'The quiet cost of explaining', 'Needing someone else to handle it. Knowing it is small — and feeling panic anyway.',
    'A world fenced by one fear', 'Camping skipped. Rooms avoided. Places you stopped letting yourself enjoy.',
    'Many clients feel a shift the same day. Stay in the room. Feel steady. Live without scanning every corner.',
    'Another year on edge', 'The camping trip you keep postponing.',
    'The map keeps shrinking', 'Each skipped place makes the next one easier to skip.',
    'More of the same results', 'If having someone else remove it hasn’t fixed the fear, it won’t next time either.',
    'Your next calm moment is one session away'],
  ['katsaridaphobia', 'fear-of-roaches', 'roaches.png', 'Fear of Roaches', 'fear of roaches',
    'See the roach. Calm and steady. Finally.',
    'Don’t let a fear of roaches run your day',
    'Kitchens, bathrooms, and late-night lights avoided — one scurrying shape keeps the upper hand. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays calm when a roach appears. That person already exists inside you.',
    'The floor, the dark, the sudden dart', 'A jolt at movement along the baseboard. Fleeing a room — or refusing to turn on the light.',
    'The quiet cost of explaining', 'Needing someone else to handle it. Knowing it is small — and feeling panic anyway.',
    'A home fenced by one fear', 'Cabinets unchecked. Nights interrupted. Spaces you stopped letting yourself relax in.',
    'Many clients feel a shift the same day. Stay in the room. Feel steady. Live without scanning every corner.',
    'Another year on edge', 'The kitchen you keep rushing through.',
    'The map keeps shrinking', 'Each skipped room makes the next one easier to skip.',
    'More of the same results', 'If having someone else remove it hasn’t fixed the fear, it won’t next time either.',
    'Your next calm moment is one session away'],
  ['ophidiophobia', 'fear-of-snakes', 'snakes.png', 'Fear of Snakes', 'fear of snakes',
    'See the snake. Calm and steady. Finally.',
    'Don’t let a fear of snakes fence in your world',
    'Trails, gardens, and even documents avoided — a coiled shape keeps the upper hand. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays calm among trails and gardens. That person already exists inside you.',
    'The grass, the trail, the image', 'Panic at a coiled shape or a photo on a screen.',
    'The quiet cost of explaining', 'Reacting strongly even to an image. Feeling embarrassed by the intensity.',
    'A world fenced by one fear', 'Hikes skipped. Gardens avoided. Places you stopped letting yourself explore.',
    'Many clients feel a shift the same day. Take the trail. Feel steady. Stay present.',
    'Another year rerouting', 'The hike you keep trading for something “safer.”',
    'The map keeps shrinking', 'Each trail declined makes the next one easier to decline.',
    'More of the same results', 'If avoidance hasn’t fixed it by now, it won’t next season either.',
    'Your next trail is one session away'],
  ['cynophobia', 'fear-of-dogs', 'dogs.png', 'Fear of Dogs', 'fear of dogs',
    'Meet the dog. Calm and at ease. Finally.',
    'Don’t let a fear of dogs reroute your life',
    'Streets crossed, visits declined, parks avoided wherever dogs might be. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who walks past a dog with ease. That person already exists inside you.',
    'The bark, the leash, the sidewalk', 'Freeze or flee at a bark. Crossing the street just in case.',
    'The quiet cost of explaining', 'Can’t come if there’s a dog. Feeling stuck while others enjoy pets freely.',
    'A world fenced by one fear', 'Friendships strained. Parks skipped. Walks you stopped letting yourself take.',
    'Many clients feel a shift the same day. Walk the block. Visit a friend. Feel at ease.',
    'Another year crossing the street', 'The park you keep avoiding “just in case.”',
    'The map keeps shrinking', 'Each detour becomes the new normal.',
    'More of the same results', 'If avoiding dogs hasn’t fixed the fear, it won’t next walk either.',
    'Your next walk is one session away'],
  ['astraphobia', 'fear-of-storms', 'storms.png', 'Fear of Storms', 'fear of storms',
    'Hear the thunder. Calm and settled. Finally.',
    'Don’t let a fear of storms rule your forecast',
    'Forecast-checking, canceled plans, hours of dread for storms that may never come. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who hears thunder and stays settled. That person already exists inside you.',
    'The sky, the radar, the rumble', 'Sky darkens and you hide in the radar loop.',
    'The quiet cost of explaining', 'Safe indoors — and still panicking. Canceling plans on a cloudy day.',
    'A world fenced by one fear', 'Events missed. Sleep lost. Days ruled by weather apps.',
    'Many clients feel a shift the same day. Hear the thunder. Stay present. Feel calm.',
    'Another season on alert', 'The gathering you keep canceling when clouds gather.',
    'The forecast runs you', 'Each storm avoided in life still lives in your body.',
    'More of the same results', 'If refreshing the radar hasn’t fixed it, it won’t next storm either.',
    'Your next calm night is one session away'],
  ['nyctophobia', 'fear-of-the-dark', 'the-dark.png', 'Fear of the Dark', 'fear of the dark',
    'Turn off the light. Calm and at peace. Finally.',
    'Don’t let a fear of the dark steal your nights',
    'Lights left on, sleep that will not come, dread as sundown approaches. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who rests easy in the dark. That person already exists inside you.',
    'The switch, the hallway, the night', 'Lights off and the heart races. Lying awake for hours.',
    'The quiet cost of explaining', 'Nights that do not restore you. Feeling childish for a fear that feels enormous.',
    'A world fenced by one fear', 'Travel disrupted. Sleep stolen. Peace you stopped letting yourself have.',
    'Many clients feel a shift the same day. Turn off the light. Rest. Wake restored.',
    'Another year of lights on', 'The night’s sleep you keep bargaining for.',
    'The nights keep costing you', 'Each restless night makes the next dread heavier.',
    'More of the same results', 'If leaving every light on hasn’t fixed it, it won’t tomorrow either.',
    'Your next good night is one session away'],
  ['coulrophobia', 'fear-of-clowns', 'clowns.png', 'Fear of Clowns', 'fear of clowns',
    'See the clown. Calm and steady. Finally.',
    'Don’t let a fear of clowns decide where you go',
    'Parties, carnivals, and movies skipped — a painted face keeps the upper hand. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays steady when the costume appears. That person already exists inside you.',
    'The paint, the smile, the party', 'Panic at a painted grin meant to be fun.',
    'The quiet cost of explaining', 'Reacting to something “harmless.” Feeling embarrassed by the intensity.',
    'A world fenced by one fear', 'Events skipped. Films avoided. Places you stopped letting yourself enjoy.',
    'Many clients feel a shift the same day. Stay present. Feel steady. Go where you want.',
    'Another year skipping the fun', 'The event you keep avoiding for one detail.',
    'The map keeps shrinking', 'Each skipped celebration makes the next easier to skip.',
    'More of the same results', 'If avoiding the subject hasn’t fixed it, it won’t next party either.',
    'Your next calm outing is one session away'],
  ['nosocomephobia', 'fear-of-hospitals', 'hospitals.png', 'Fear of Hospitals', 'fear of hospitals',
    'Walk through the doors. Calm and steady. Finally.',
    'Don’t let a fear of hospitals stand between you and care',
    'Appointments postponed, visits by phone only — dread of the building itself. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who walks into care calmly when you need it. That person already exists inside you.',
    'The doors, the halls, the smell', 'Door dread. Lights, corridors, and sounds that spike panic.',
    'The quiet cost of explaining', 'Guilt plus postponed care. Knowing you need to go — and delaying anyway.',
    'A world fenced by one fear', 'Health delayed. Family visits missed. Care you stopped letting yourself get.',
    'Many clients feel a shift the same day. Walk in. Sit. Receive care with steadiness.',
    'Another year postponing', 'The appointment you keep pushing out.',
    'Avoidance has a cost', 'Each delay can turn a small issue into a larger one.',
    'More of the same results', 'If waiting it out hasn’t fixed the dread, it won’t next visit either.',
    'Your next appointment is one session away'],
  ['iatrophobia', 'fear-of-doctors', 'doctors.png', 'Fear of Doctors', 'fear of doctors',
    'Keep the appointment. Calm and steady. Finally.',
    'Don’t let a fear of doctors stand between you and your health',
    'Check-ups postponed, symptoms unmentioned, last-minute cancels. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who sits calmly through an appointment. That person already exists inside you.',
    'The waiting room, the coat, the check-up', 'Heart racing before the door opens. White-coat spike.',
    'The quiet cost of explaining', 'Fear of what they might find — and silence that delays answers.',
    'A world fenced by one fear', 'Symptoms ignored. Care deferred. Peace of mind you stopped letting yourself have.',
    'Many clients feel a shift the same day. Keep the appointment. Speak up. Feel steady.',
    'Another year canceling', 'The check-up you reschedule one more time.',
    'Avoidance has a cost', 'Each skipped visit can leave questions unanswered.',
    'More of the same results', 'If white-knuckling the waiting room hasn’t fixed it, it won’t next time either.',
    'Your next visit is one session away'],
  ['pteridophobia', 'fear-of-ferns', 'ferns.png', 'Fear of Ferns', 'fear of ferns',
    'See the fern. Calm and at ease. Finally.',
    'Don’t let a fear of ferns narrow your world',
    'Gardens and rooms avoided — a specific plant triggers real unease. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays at ease around greenery. That person already exists inside you.',
    'The fronds, the texture, the room', 'Unease at the sight or texture of a fern.',
    'The quiet cost of explaining', 'Embarrassed by a reaction to a plant. Feeling alone in it.',
    'A world fenced by one fear', 'Rooms avoided. Gardens skipped. Spaces you stopped letting yourself enjoy.',
    'Many clients feel a shift the same day. Stay present. Feel ease. Move freely.',
    'Another year navigating around it', 'The room or garden you keep skipping.',
    'The map keeps shrinking', 'Each avoided space becomes a larger pattern.',
    'More of the same results', 'If avoiding ferns hasn’t fixed the fear, it won’t next season either.',
    'Your next calm space is one session away'],
  ['botanophobia', 'fear-of-plants', 'plants.png', 'Fear of Plants', 'fear of plants',
    'Be among the green. Calm and at ease. Finally.',
    'Don’t let a fear of plants narrow your world',
    'Gardens, parks, and leafy rooms skipped — greenery keeps the upper hand. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who moves easily among plants. That person already exists inside you.',
    'The garden, the plant, the room', 'Avoiding gardens and houseplants that other people love.',
    'The quiet cost of explaining', 'Unease at something “harmless.” Feeling isolated by the response.',
    'A world fenced by one fear', 'Outdoors limited. Homes reshaped. Places you stopped letting yourself enjoy.',
    'Many clients feel a shift the same day. Walk the garden path. Feel ease. Stay present.',
    'Another year avoiding green', 'The park or patio you keep choosing not to visit.',
    'The map keeps shrinking', 'Each avoided garden becomes a larger fence.',
    'More of the same results', 'If avoidance hasn’t fixed it, it won’t next outing either.',
    'Your next garden walk is one session away'],
  ['trypanophobia', 'fear-of-needles', 'needles.png', 'Fear of Needles', 'fear of needles',
    'Get the shot. Calm and steady. Finally.',
    'Don’t let a fear of needles run your health',
    'Skipped bloodwork, postponed vaccines, procedures delayed for years. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who gets the shot and stays steady. That person already exists inside you.',
    'The wait, the pinch, the appointment', 'Days-ahead dread. Near-faint when the needle appears.',
    'The quiet cost of explaining', '“Just a pinch” still overwhelms. Health delayed by dread.',
    'A world fenced by one fear', 'Care postponed. Peace deferred. Procedures you stopped scheduling.',
    'Many clients feel a shift the same day. Keep the appointment. Stay steady. Done.',
    'Another year postponing care', 'The bloodwork you keep putting off.',
    'Avoidance has a cost', 'Each delay can make care harder later.',
    'More of the same results', 'If looking away harder hasn’t fixed it, it won’t next shot either.',
    'Your next appointment is one session away'],
  ['hemophobia', 'fear-of-blood', 'blood.png', 'Fear of Blood', 'fear of blood',
    'See the blood. Calm and steady. Finally.',
    'Don’t let a fear of blood catch you off guard',
    'Appointments postponed, first aid avoided — the next glimpse always one surprise away. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays steady when blood appears. That person already exists inside you.',
    'The sight, the smell, the moment', 'Lightheaded, sweaty, or faint at the sight of blood.',
    'The quiet cost of explaining', 'Nearly going down. Avoiding situations where blood might appear.',
    'A world fenced by one fear', 'Care delayed. Panic at minor cuts. Peace you stopped trusting.',
    'Many clients feel a shift the same day. Stay present. Feel steady. Respond calmly.',
    'Another year bracing', 'The appointment you keep delaying for this reason.',
    'Surprises still win', 'Each avoidant choice leaves the fear in charge.',
    'More of the same results', 'If looking away hasn’t fixed it, it won’t next time either.',
    'Your next calm response is one session away'],
  ['emetophobia', 'fear-of-being-sick', 'being-sick.png', 'Fear of Being Sick', 'fear of being sick',
    'Eat. Travel. Feel settled. Finally.',
    'Don’t let a fear of being sick shrink your days',
    'Foods and places avoided, constant body-checking — worry runs the day. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who feels settled in your own body. That person already exists inside you.',
    'The meal, the trip, the worry', 'Avoiding foods, restaurants, travel, or anyone who might be ill.',
    'The quiet cost of explaining', 'Always on alert. Exhausted by vigilance.',
    'A world fenced by one fear', 'Social life reduced. Travel skipped. Ease you stopped letting yourself feel.',
    'Many clients feel a shift the same day. Eat. Travel. Feel settled again.',
    'Another year on high alert', 'The dinner out you keep declining.',
    'The map keeps shrinking', 'Each avoided place becomes a larger pattern.',
    'More of the same results', 'If hypervigilance hasn’t fixed it, it won’t next week either.',
    'Your next easy day is one session away'],
  ['mysophobia', 'fear-of-germs', 'germs.png', 'Fear of Germs', 'fear of germs',
    'Touch the world. Calm and at ease. Finally.',
    'Don’t let a fear of germs rule your day',
    'Handles and handshakes avoided; hours of washing and checking. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who moves through the day at ease. That person already exists inside you.',
    'The handle, the handshake, the check', 'Washing past clean. Mapping contamination everywhere.',
    'The quiet cost of explaining', 'Constant vigilance fatigue. Feeling trapped by routines that never finish.',
    'A world fenced by one fear', 'Touch avoided. Time lost. Ease you stopped allowing.',
    'Many clients feel a shift the same day. Touch. Move. Feel free again.',
    'Another year of checking', 'The routine that never quite feels done.',
    'Vigilance keeps winning', 'Each extra wash reinforces the loop.',
    'More of the same results', 'If cleaning more hasn’t fixed the dread, it won’t tomorrow either.',
    'Your next easy day is one session away'],
  ['telephobia', 'fear-of-phone-calls', 'phone-calls.png', 'Fear of Phone Calls', 'fear of phone calls',
    'Make the call. Calm and confident. Finally.',
    'Don’t let a fear of calls hold your work back',
    'Voicemail instead of pickup; follow-ups delayed; email instead of a two-minute call — work shaped by dread. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who picks up and dials with ease. That person already exists inside you.',
    'The ring, the dial, the pause', 'Stomach drop on the ring. Rehearse, then delay.',
    'The quiet cost of explaining', 'A two-minute call still sparks panic. Opportunities slip to silence.',
    'A world fenced by one fear', 'Deals delayed. Relationships strained. Calls you stopped making.',
    'Many clients feel a shift the same day. Dial. Speak. Hang up with ease.',
    'Another year of delayed follow-ups', 'The call you keep meaning to return.',
    'Avoidance has a cost', 'Each unmade call can cost income and trust.',
    'More of the same results', 'If rehearsing longer hasn’t fixed it, it won’t next ring either.',
    'Your next call is one session away'],
  ['sales-call-anxiety', 'fear-of-sales-calls', 'sales-calls.png', 'Sales Call Anxiety', 'sales call anxiety',
    'Make the call. Close with confidence. Finally.',
    'Don’t let call reluctance cap your numbers',
    'Undials, cold follow-ups skipped, talks out of closes — commissions lost to avoidance. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who dials, connects, and closes calmly. That person already exists inside you.',
    'The dialer, the script, the close', 'Staring at the dialer. Doing “admin” first. Bracing for every no.',
    'The quiet cost of explaining', 'Knowing the script and still freezing. Watching pipeline slip.',
    'A world fenced by one fear', 'Targets missed. Momentum lost. Calls you stopped making.',
    'Many clients feel a shift the same day. Dial. Talk. Close with confidence.',
    'Another month under target', 'The list you keep not dialing.',
    'Avoidance has a cost', 'Each undialed lead is money left on the table.',
    'More of the same results', 'If more coffee and “warming up” hasn’t fixed it, it won’t next quarter either.',
    'Your next dial is one session away'],
  ['rejection-sensitivity', 'fear-of-rejection', 'rejection.png', 'Fear of Rejection', 'fear of rejection',
    'Put yourself out there. Steady and unshaken. Finally.',
    'Don’t let a fear of rejection keep you small',
    'Pitches, applications, and relationships not pursued — one “no” wrecks the week. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who risks the ask and stays steady. That person already exists inside you.',
    'The ask, the send, the reply', 'Not asking. Not sending. Replaying criticism for days.',
    'The quiet cost of explaining', 'Hearing “no” as a verdict on your worth.',
    'A world fenced by one fear', 'Ideas unsaid. Love unasked. Chances you stopped taking.',
    'Many clients feel a shift the same day. Ask. Send. Stay steady either way.',
    'Another year playing small', 'The pitch you keep not sending.',
    'Silence has a cost', 'Each unasked question is a door that stays closed.',
    'More of the same results', 'If avoiding the risk hasn’t fixed the sting, it won’t next time either.',
    'Your next brave ask is one session away'],
  ['rejection-sensitive-dysphoria', 'fear-of-rejection-sensitivity', 'rejection-sensitivity.png', 'Rejection Sensitive Dysphoria', 'rejection sensitive dysphoria',
    'Ease the sting. Steady and settled. Finally.',
    'Don’t let the intensity run your days',
    'Perceived rejection can land as near-physical pain; days reorganize around avoiding it. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who stays settled when feedback comes. That person already exists inside you.',
    'The slight, the replay, the spiral', 'A small slight becomes a blow. Hours replaying a moment.',
    'The quiet cost of explaining', 'Feeling “built too sensitive.” Exhausted by intensity.',
    'A world fenced by one fear', 'Connections avoided. Risks declined. Ease you stopped trusting.',
    'Many clients feel a shift the same day. Hear it. Stay present. Soften the sting.',
    'Another week derailed', 'The comment that still owns your mood.',
    'Intensity has a cost', 'Each spiral steals days you deserved to enjoy.',
    'More of the same results', 'If white-knuckling feelings hasn’t fixed it, it won’t next slight either.',
    'Your next settled day is one session away'],
  ['dentophobia', 'fear-of-the-dentist', 'the-dentist.png', 'Fear of the Dentist', 'fear of the dentist',
    'Sit in the chair. Calm and free. Finally.',
    'Don’t let a fear of the dentist cost you your health',
    'Cancelled cleanings, small problems grown large — pain endured over the chair. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who sits calmly through dental care. That person already exists inside you.',
    'The chair, the drill, the appointment', 'Drill and needle dread. Last-minute cancel.',
    'The quiet cost of explaining', 'Shame about years since the last visit — and still postponing.',
    'A world fenced by one fear', 'Pain ignored. Care delayed. Smiles you stopped trusting.',
    'Many clients feel a shift the same day. Sit. Breathe. Finish the visit calmly.',
    'Another year canceling', 'The cleaning you keep rescheduling.',
    'Avoidance has a cost', 'Each delay can turn a small fix into a larger one.',
    'More of the same results', 'If white-knuckling hasn’t fixed it, it won’t next visit either.',
    'Your next visit is one session away'],
  ['enochlophobia', 'fear-of-crowds', 'crowds.png', 'Fear of Crowds', 'fear of crowds',
    'Walk into the crowd. Calm and free. Finally.',
    'Don’t let a fear of crowds shrink your map',
    'Concerts, festivals, and busy stores skipped — life happens in rooms you cannot join. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who moves through a crowd with ease. That person already exists inside you.',
    'The crush, the exits, the room', 'Packed-space panic. Scanning for exits.',
    'The quiet cost of explaining', 'Leaving early. “It’s just people” — and still drowning.',
    'A world fenced by one fear', 'Events missed. Joy postponed. Places you stopped letting yourself go.',
    'Many clients feel a shift the same day. Enter the room. Stay. Enjoy it.',
    'Another year on the sidelines', 'The show you keep watching from home.',
    'The map keeps shrinking', 'Each skipped gathering makes the next one harder.',
    'More of the same results', 'If arriving late and leaving early hasn’t fixed it, it won’t next event either.',
    'Your next gathering is one session away'],
  ['gerascophobia', 'fear-of-aging', 'aging.png', 'Fear of Aging', 'fear of aging',
    'Embrace every year. Calm and free. Finally.',
    'Don’t let a fear of aging steal the years you have',
    'Birthday dread, mirror checks — the present slips by while bracing for tomorrow. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who meets each year with ease. That person already exists inside you.',
    'The mirror, the birthday, the calendar', 'A knot before birthdays. Fixating on gray or lines.',
    'The quiet cost of explaining', 'Time-running-out loops. Missing today over tomorrow.',
    'A world fenced by one fear', 'Joy delayed. Presence lost. Years you stopped celebrating.',
    'Many clients feel a shift the same day. Look ahead. Feel settled. Live this year.',
    'Another birthday with dread', 'The celebration you keep wanting to skip.',
    'Presence has a cost when fear wins', 'Each worried hour steals a free one.',
    'More of the same results', 'If checking the mirror more hasn’t fixed it, it won’t next year either.',
    'Your next peaceful year starts in one session'],
  ['eisoptrophobia', 'fear-of-mirrors', 'mirrors.png', 'Fear of Mirrors', 'fear of mirrors',
    'Look in the mirror. Calm and free. Finally.',
    'Don’t let a fear of mirrors shrink your world',
    'Rooms and dark windows avoided — a fear few people understand. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who looks without fear. That person already exists inside you.',
    'The glass, the reflection, the room', 'Covering mirrors. Averting a glance.',
    'The quiet cost of explaining', 'Hard to explain a fear others call strange.',
    'A world fenced by one fear', 'Spaces avoided. Routines twisted. Ease you stopped having at home.',
    'Many clients feel a shift the same day. Look. Stay present. Feel free.',
    'Another year navigating around glass', 'The room you keep avoiding.',
    'Home should feel safe', 'Each covered mirror costs comfort.',
    'More of the same results', 'If looking away hasn’t fixed it, it won’t tomorrow either.',
    'Your next free glance is one session away'],
  ['scopophobia', 'fear-of-being-stared-at', 'being-stared-at.png', 'Fear of Being Stared At', 'fear of being stared at',
    'Let them look. Calm and free. Finally.',
    'Don’t let a fear of being watched keep you in the shadows',
    'Back rows chosen, attention deflected — chances to be seen pass by. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who is seen and stays calm. That person already exists inside you.',
    'The eyes, the room, the moment', 'Blush, freeze, or hide when you feel watched.',
    'The quiet cost of explaining', 'Certainty of judgment. Shrinking whenever attention finds you.',
    'A world fenced by one fear', 'Opportunities declined. Visibility avoided. Presence you stopped offering.',
    'Many clients feel a shift the same day. Be seen. Stay. Feel free.',
    'Another year in the back row', 'The role you keep declining.',
    'Visibility has a cost when fear wins', 'Each hide reinforces the loop.',
    'More of the same results', 'If staying invisible hasn’t fixed it, it won’t next time either.',
    'Your next visible moment is one session away'],
  ['decidophobia', 'fear-of-making-decisions', 'making-decisions.png', 'Fear of Making Decisions', 'fear of making decisions',
    'Make the choice. Calm and free. Finally.',
    'Don’t let a fear of deciding keep you stuck',
    'Decisions pile up; opportunities miss while you weigh; others choose for you. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who chooses with calm confidence. That person already exists inside you.',
    'The options, the pause, the stall', 'Paralysis. Defer. Avoid. Let someone else decide.',
    'The quiet cost of explaining', 'Dreading choosing wrong — so choosing nothing.',
    'A world fenced by one fear', 'Momentum lost. Opportunities missed. A life stuck in limbo.',
    'Many clients feel a shift the same day. Choose. Move. Feel free.',
    'Another year stuck in maybe', 'The decision you keep circling.',
    'Indecision has a cost', 'Each delay is a choice by default.',
    'More of the same results', 'If researching longer hasn’t fixed it, it won’t next choice either.',
    'Your next clear choice is one session away'],
  ['deipnophobia', 'fear-of-eating-in-public', 'eating-in-public.png', 'Fear of Eating in Public', 'fear of eating in public',
    'Eat in public. Calm and free. Finally.',
    'Don’t let a fear of eating in public shrink your social life',
    'Dinners, dates, and work lunches skipped — friendships and opportunities pass the table. The villain is not you. It is a misfiring subconscious program — once meant to protect you, now firing indiscriminately.',
    'You are someone who dines out at ease. That person already exists inside you.',
    'The table, the meal, the room', 'Pre-meal anxiety. Tremble. Declined invites.',
    'The quiet cost of explaining', 'Sure everyone is watching you eat.',
    'A world fenced by one fear', 'Dates missed. Collegial moments skipped. Joy you stopped sharing.',
    'Many clients feel a shift the same day. Sit. Eat. Enjoy the company.',
    'Another year declining dinner', 'The invite you keep turning down.',
    'Connection has a cost when fear wins', 'Each skipped meal is a missed relationship.',
    'More of the same results', 'If eating alone hasn’t fixed it, it won’t next invite either.',
    'Your next meal out is one session away'],
];

for (const row of MORE) {
  const [
    latin, slug, image, label, fearShort, heroH1, problemH2, problemP, quote,
    externalH3, externalP, internalH3, internalP, deeperH3, deeperP, reliefP,
    cost1H3, cost1P, cost2H3, cost2P, cost3H3, cost3P, ctaH2,
  ] = row;
  PHOBIAS.push({
    latin, slug, image, label, fearShort,
    title: defaultTitle(label),
    description: `Overcome ${fearShort} in one peaceful Zoom session. No trance, no exposure, no long-term therapy.`,
    heroH1, heroP:
      'One peaceful Zoom session. No trance. No reliving trauma. No long-term therapy — a calmer, freer you on your terms.',
    problemH2,
    heroTag: deriveHeroTag(fearShort, problemH2),
    problemP, quote,
    externalH3, externalP, internalH3, internalP, deeperH3, deeperP, reliefP,
    cost1H3, cost1P, cost2H3, cost2P, cost3H3, cost3P, ctaH2,
  });
}

const BODY_TEMPLATE = `<section class="hero">
  <div class="hero-veil" aria-hidden="true"></div>
  <div class="hero-inner">
    <p class="hero-brand">Phobia<em>Free</em>.life</p>
    <p class="hero-fear">{{HERO_TAG}}</p>
    <h1>{{HERO_H1}}</h1>
    <p>{{HERO_P}}</p>
    <div class="hero-actions">
      <a class="btn btn-book" href="#" onclick="openModal(event)">Book Consultation</a>
    </div>
  </div>
</section>

<main>
  <section class="section section-overlap">
    <div class="bento">

      <article class="tile tile-guarantee span-8">
        <span class="eyebrow">The PhobiaFree Guarantee</span>
        <h2>If you are not completely satisfied after your first session, you don’t pay.</h2>
        <p>Simple as that — because the goal isn’t a fear you simply manage. It’s lasting relief you can feel.</p>
      </article>

      <article class="tile span-4">
        <div class="stats">
          <div class="stat"><strong>1</strong><span>Session</span></div>
          <div class="stat"><strong>100%</strong><span>Via Zoom</span></div>
          <div class="stat"><strong>0</strong><span>Exposure</span></div>
        </div>
      </article>

      <article class="tile span-7" id="problem">
        <span class="eyebrow">You are not alone</span>
        <h2>{{PROBLEM_H2}}</h2>
        <p>{{PROBLEM_P}}</p>
      </article>

      <article class="tile tile-quote span-5">
        <blockquote>{{QUOTE}}</blockquote>
      </article>

      <article class="tile span-4">
        <span class="eyebrow">External</span>
        <h3>{{EXTERNAL_H3}}</h3>
        <p>{{EXTERNAL_P}}</p>
      </article>

      <article class="tile span-4">
        <span class="eyebrow">Internal</span>
        <h3>{{INTERNAL_H3}}</h3>
        <p>{{INTERNAL_P}}</p>
      </article>

      <article class="tile span-4">
        <span class="eyebrow">Deeper</span>
        <h3>{{DEEPER_H3}}</h3>
        <p>{{DEEPER_P}}</p>
      </article>

      <article class="tile span-5">
        <span class="eyebrow">Your guide</span>
        <h2>I understand. Let me help.</h2>
        <p>With over 12 years of experience, I’ve helped hundreds regain their freedom from fear. Together, we replace the fear with emotions you choose — safe, empowered, calm.</p>
      </article>

      <article class="tile span-7">
        <span class="eyebrow">Credentials</span>
        <h3>Certified clinical hypnotherapist</h3>
        <p>Florida Institute of Hypnotherapy · HMI College of Hypnotherapy · Secure Zoom sessions worldwide. If a physician has diagnosed your phobia, I partner with your doctor. If not, we can typically begin right away.</p>
      </article>

    </div>
  </section>

  <section class="section" id="how">
    <h2 class="section-title">3 simple steps to freedom</h2>
    <div class="bento">
      <article class="tile span-4">
        <span class="step-num">01</span>
        <h3>Book Consultation</h3>
        <p>A quick chat over Zoom. You share your fear, your history, and how you want to feel instead.</p>
        <span class="chip">Complimentary · No obligation</span>
        <div class="step-cta">
          <a class="btn btn-book" href="#" onclick="openModal(event)">Book Consultation</a>
        </div>
      </article>
      <article class="tile span-4">
        <span class="step-num">02</span>
        <h3>Receive your tailored session</h3>
        <p>One peaceful Zoom session, customized toward relief. Only words — quietly replacing fear with the emotions you chose.</p>
        <span class="chip">One session · Deeply relaxing</span>
      </article>
      <article class="tile span-4">
        <span class="step-num">03</span>
        <h3>Experience relief</h3>
        <p>{{RELIEF_P}}</p>
        <span class="chip">Phobia free · On your terms</span>
      </article>

      <article class="tile span-12">
        <span class="eyebrow">Most approaches reduce fear</span>
        <h2>Let’s replace yours</h2>
        <div class="compare-grid" style="margin-top:1rem">
          <div class="compare compare-old">
            <h3>Traditional approaches</h3>
            <ul>
              <li>Re-exposure to the feared situation</li>
              <li>Months or years of ongoing sessions</li>
              <li>Goal: reduce anxiety to “manageable”</li>
              <li>In-person visits required</li>
            </ul>
          </div>
          <div class="compare compare-new">
            <h3>PhobiaFree.life method</h3>
            <ul>
              <li>No re-exposure, no reliving, no trance</li>
              <li>One session — that’s the plan</li>
              <li>Goal: feel exactly how you choose</li>
              <li>Private Zoom from anywhere</li>
            </ul>
          </div>
        </div>
      </article>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="bento">
      <article class="tile span-12">
        <span class="eyebrow">Questions</span>
        <h2>Frequently asked</h2>
        <div class="faq-list">
          <details class="faq">
            <summary>Will I be hypnotized?</summary>
            <p>No — not in the way you’re imagining. Although I am a certified clinical hypnotherapist, this method involves no trance and no loss of control. You remain relaxed, aware, and fully in charge.</p>
          </details>
          <details class="faq">
            <summary>Will I have to experience my fear during the session?</summary>
            <p>Absolutely not. I never expose you to your fear — not in imagery, not in discussion, not in any form.</p>
          </details>
          <details class="faq">
            <summary>How many sessions will I need?</summary>
            <p>One. The complimentary consultation lets me design a complete, tailored therapy so we get it right the first time.</p>
          </details>
          <details class="faq">
            <summary>Can this really work over Zoom?</summary>
            <p>Yes — and it works beautifully. The entire method is spoken word. The comfort of your own home enhances the relaxation response.</p>
          </details>
          <details class="faq">
            <summary>What if I’m not satisfied after my session?</summary>
            <p>Then you don’t pay. If you are not completely satisfied after your first session, there is no charge.</p>
          </details>
        </div>
      </article>

      <article class="tile span-4">
        <h3>{{COST1_H3}}</h3>
        <p>{{COST1_P}}</p>
      </article>
      <article class="tile span-4">
        <h3>{{COST2_H3}}</h3>
        <p>{{COST2_P}}</p>
      </article>
      <article class="tile span-4">
        <h3>{{COST3_H3}}</h3>
        <p>{{COST3_P}}</p>
      </article>

      <article class="tile cta-tile span-12">
        <span class="eyebrow">Your next step</span>
        <h2>{{CTA_H2}}</h2>
        <p class="lead">The consultation is complimentary, the process is peaceful, and your satisfaction is guaranteed.</p>
        <div class="cta-actions">
          <a class="btn btn-solid btn-book" href="#" onclick="openModal(event)">Book Consultation</a>
        </div>
        <p class="footnote">“I feel like myself again.” — the most common thing clients say after their session.</p>
      </article>
    </div>
  </section>
</main>
`;

function fill(str, map) {
  let out = str;
  for (const [k, v] of Object.entries(map)) {
    out = out.split('{{' + k + '}}').join(v);
  }
  return out;
}

function buildModalOptions(selectedSlug) {
  const lines = ['        <option value="" data-slug="">Select one...</option>'];
  for (const p of PHOBIAS) {
    const sel = p.slug === selectedSlug ? ' selected' : '';
    lines.push(
      `        <option value="${p.label}" data-slug="${p.slug}"${sel}>${p.label}</option>`
    );
  }
  lines.push('        <option value="Other (describe below)" data-slug="my_fear">Other (describe below)</option>');
  return lines.join('\n');
}

function writeModalInclude() {
  const modalPath = path.join(BENTO, 'newincludes/modal.html');
  let modal = fs.readFileSync(modalPath, 'utf8');
  const start = modal.indexOf('<select id="cf_phobia">');
  const end = modal.indexOf('</select>', start);
  if (start < 0 || end < 0) throw new Error('modal select not found');
  const rebuilt =
    modal.slice(0, start) +
    '<select id="cf_phobia">\n' +
    buildModalOptions('fear-of-flying') +
    '\n      </select>' +
    modal.slice(end + '</select>'.length);
  fs.writeFileSync(modalPath, rebuilt);
  console.log('updated modal options → fear-of-* slugs');
}

function ensureImgDir(slug, image, seedFromFlying) {
  const imgDir = path.join(PUBLIC, slug, 'img');
  fs.mkdirSync(imgDir, { recursive: true });
  const dest = path.join(imgDir, image);
  if (!fs.existsSync(dest) && seedFromFlying) {
    const srcCandidates = [
      path.join(PUBLIC, 'fear-of-flying/img/flying.png'),
      path.join(PUBLIC, 'fear-of-flying/img/hero-boarding.png'),
    ];
    for (const src of srcCandidates) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        break;
      }
    }
  }
  // Drop a tiny placeholder note if no image yet
  const note = path.join(imgDir, 'README.txt');
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(
      note,
      `Place hero image here as: ${image}\nServed at: /${slug}/img/${image}\n`
    );
  }
}

function main() {
  fs.mkdirSync(PAGES, { recursive: true });
  fs.writeFileSync(path.join(BENTO, 'body.template.html'), BODY_TEMPLATE);
  fs.writeFileSync(path.join(BENTO, 'phobias.json'), JSON.stringify(PHOBIAS, null, 2) + '\n');

  // Seed flying.png from existing boarding photo
  const flyingDir = path.join(PUBLIC, 'fear-of-flying/img');
  fs.mkdirSync(flyingDir, { recursive: true });
  const boarding = path.join(flyingDir, 'hero-boarding.png');
  const flying = path.join(flyingDir, 'flying.png');
  if (fs.existsSync(boarding) && !fs.existsSync(flying)) {
    fs.copyFileSync(boarding, flying);
    console.log('seeded flying.png from hero-boarding.png');
  }

  writeModalInclude();

  for (const p of PHOBIAS) {
    const dir = path.join(PAGES, p.slug);
    fs.mkdirSync(dir, { recursive: true });

    const body = fill(BODY_TEMPLATE, {
      LABEL: p.label,
      HERO_TAG: p.heroTag || p.problemH2,
      HERO_H1: p.heroH1,
      HERO_P: p.heroP,
      PROBLEM_H2: p.problemH2,
      PROBLEM_P: p.problemP,
      QUOTE: p.quote,
      EXTERNAL_H3: p.externalH3,
      EXTERNAL_P: p.externalP,
      INTERNAL_H3: p.internalH3,
      INTERNAL_P: p.internalP,
      DEEPER_H3: p.deeperH3,
      DEEPER_P: p.deeperP,
      RELIEF_P: p.reliefP,
      COST1_H3: p.cost1H3,
      COST1_P: p.cost1P,
      COST2_H3: p.cost2H3,
      COST2_P: p.cost2P,
      COST3_H3: p.cost3H3,
      COST3_P: p.cost3P,
      CTA_H2: p.ctaH2,
    });
    fs.writeFileSync(path.join(dir, 'body.html'), body);

    const same = { [p.slug]: true, [p.latin]: true };
    const page = {
      slug: p.slug,
      title: p.title,
      description: p.description,
      cssHref: `/${p.slug}/styles.css`,
      photoUrl: `/${p.slug}/img/${p.image}`,
      pfCurrentSlug: p.slug,
      pfSamePageSlugs: same,
      selectedPhobiaSlug: p.slug,
      assetDir: p.slug,
      latinSlug: p.latin,
      label: p.label,
      image: p.image,
    };
    fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(page, null, 2) + '\n');

    ensureImgDir(p.slug, p.image, p.slug === 'fear-of-flying');
  }

  // Latin → fear-of-* redirects map for the worker
  const redirects = {};
  for (const p of PHOBIAS) redirects['/' + p.latin] = '/' + p.slug;
  fs.writeFileSync(path.join(BENTO, 'latin-redirects.json'), JSON.stringify(redirects, null, 2) + '\n');

  console.log(`generated ${PHOBIAS.length} page packs`);

  // Services page (static HTML list — no JS needed to show the menu)
  const servicesTpl = fs.readFileSync(path.join(BENTO, 'services.template.html'), 'utf8');
  const servicesHtml = PHOBIAS.map(
    (p) => `      <a class="service-link" href="/${p.slug}"><span>${p.label}</span></a>`
  ).join('\n');
  fs.writeFileSync(
    path.join(PUBLIC, 'services.html'),
    servicesTpl.replace('__SERVICES_HTML__', servicesHtml)
  );
  console.log('wrote public/services.html');
}

main();
