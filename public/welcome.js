// welcome.js — shared JS for all welcome-*.php pages and index.php

var SITE         = 'https://www.phobiafree.life';
var GENERAL_PAGE = '/my_fear';

window._welcomeScene = window._welcomeScene || 'home';
window._welcomeItem  = window._welcomeItem  || '';

function trackScene(scene, item) {
  window._welcomeScene = scene;
  window._welcomeItem  = item || '';
}

function withVid(url) {
  var vid = sessionStorage.getItem('pfvid') || '';
  if (!vid) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'vid=' + encodeURIComponent(vid);
}
function getVid() { return sessionStorage.getItem('pfvid') || ''; }
function enterSite() { window.location.href = withVid(SITE + GENERAL_PAGE); }
function curioCta(url) { window.location.href = withVid(url); }

function selectFear(f) {
  // Go straight to the phobia page on the real site.
  // index.php overrides this with an AJAX version that loads welcome-fear-selected.php.
  var dest = !f.slug ? (SITE + GENERAL_PAGE) : (SITE + '/' + f.slug);
  window.location.href = withVid(dest);
}

function selectCurio(f) {
  document.getElementById('curio-emoji').textContent = f.emoji;
  document.getElementById('curio-title').innerHTML   = '<em>' + f.title + '</em>';
  document.getElementById('curio-body').textContent  = f.body;
  var btns = document.getElementById('curio-btns');
  btns.innerHTML = '';
  (f.btns || []).forEach(function(b) {
    var btn = document.createElement('button');
    btn.className = 'welcome-btn';
    btn.textContent = b.label;
    btn.onclick = new Function(b.fn + ';');
    btns.appendChild(btn);
  });
  trackScene('curious-selected', f.label);
  if (typeof go === 'function') go('curious-selected');
}

function selectWhy(f) {
  document.getElementById('why-emoji').textContent = f.emoji;
  document.getElementById('why-title').innerHTML   = '<em>' + f.title + '</em>';
  document.getElementById('why-body').textContent  = f.body;
  var btns = document.getElementById('why-btns');
  btns.innerHTML = '';
  (f.btns || []).forEach(function(b) {
    var btn = document.createElement('button');
    btn.className = 'welcome-btn';
    btn.textContent = b.label;
    btn.onclick = new Function(b.fn + ';');
    btns.appendChild(btn);
  });
  trackScene('why-selected', f.label);
  if (typeof go === 'function') go('why-selected');
}

var fears = [
  { label:'Public Speaking', size:2.7, color:'#1a6b72', x:3, y:6, r:-2, slug:'glossophobia',
    headline:'You have something worth saying. Say it.', body:'The most common fear in the world. Not a skills problem — a nervous system problem. One peaceful Zoom session changes the response.' },
  { label:'Flying', size:2.5, color:'#1a6b72', x:55, y:4, r:2, slug:'aerophobia',
    headline:'The flight is waiting for you.', body:'Fear of flying has grounded millions from trips, family moments, and career opportunities. One peaceful Zoom session — no planes required.' },
  { label:'Needles', size:2.5, color:'#c9a84c', x:30, y:14, r:-1, slug:'trypanophobia',
    headline:'Your fear of needles ends here.', body:'Blood draws, vaccines, dental work — needle fear affects millions. One peaceful Zoom session can change that. (A physician referral is required for this one.)' },
  { label:'Sales Calls', size:2.4, color:'#c9a84c', x:74, y:20, r:2, slug:'sales-call-anxiety',
    headline:'You know how to sell. Your nerves disagree.', body:'Call reluctance isn\'t a skills gap — it\'s a nervous system problem, and it\'s quietly capping your commission. One session changes the response.' },
  { label:'Spiders', size:2.0, color:'#7a9e7e', x:5, y:30, r:2, slug:'arachnophobia',
    headline:'A spider is not the threat your fear believes.', body:'One of the most common fears in the world — and one of the most successfully addressed in a single session.' },
  { label:'Heights', size:1.95, color:'#2a8a93', x:62, y:38, r:-3, slug:'acrophobia',
    headline:'The summit was always yours to take.', body:'One session can change what heights mean to your nervous system. No exposure. No ladders. Just words.' },
  { label:'Enclosed Spaces', size:1.85, color:'#1a6b72', x:25, y:42, r:1, slug:'claustrophobia',
    headline:'Space exists. Your fear of losing it doesn\'t have to.', body:'MRI, elevators, aircraft — one session recalibrates your nervous system without ever entering a confined space.' },
  { label:'Dogs', size:1.8, color:'#7a9e7e', x:80, y:44, r:3, slug:'cynophobia',
    headline:'Most dogs just want to say hello.', body:'Fear of dogs reroutes walks, visits, and whole neighborhoods. One session changes the response — no dogs in the room.' },
  { label:'Phone Calls', size:1.8, color:'#2a8a93', x:8, y:52, r:-2, slug:'telephobia',
    headline:'Pick up the phone. Feel nothing but calm.', body:'One of the most limiting anxieties of modern life. One session changes what a ringing phone means to your nervous system.' },
  { label:'Sales Rejection', size:1.9, color:'#c9a84c', x:48, y:54, r:2, slug:'rejection-sensitivity',
    headline:'A "no" is data, not a verdict.', body:'Fear of rejection keeps the pitch unmade and the week derailed. Not a confidence problem — a nervous system one. One session changes it.' },
  { label:'Snakes', size:1.6, color:'#1a6b72', x:68, y:60, r:-2, slug:'ophidiophobia',
    headline:'A snake is rarely the threat your fear insists.', body:'One session can change what snakes mean to your nervous system — no live snakes, no images, just words.' },
  { label:'Storms', size:1.55, color:'#7a9e7e', x:6, y:68, r:2, slug:'astraphobia',
    headline:'The forecast doesn\'t get to run your day.', body:'Thunder, lightning, the dread before the sky even darkens — one session changes what storms mean to your nervous system.' },
  { label:'Water', size:1.5, color:'#2a8a93', x:38, y:70, r:-1, slug:'aquaphobia',
    headline:'The water was always meant to hold you.', body:'Pools, oceans, the deep end — one session recalibrates your nervous system, no swimming required.' },
  { label:'Driving', size:1.55, color:'#1a6b72', x:84, y:64, r:2, slug:'amaxophobia',
    headline:'The open road is yours again.', body:'Highways, bridges, merging — fear of driving quietly shrinks your independence. One session changes the response.' },
  { label:'The Dark', size:1.45, color:'#c9a84c', x:18, y:80, r:-2, slug:'nyctophobia',
    headline:'The night was always meant for rest.', body:'Fear of the dark steals sleep and whole nights. One session changes what darkness means to your nervous system.' },
  { label:'Germs', size:1.5, color:'#7a9e7e', x:52, y:82, r:1, slug:'mysophobia',
    headline:'The world is cleaner than your fear thinks.', body:'The rituals. The hypervigilance. The exhaustion. One session recalibrates the threat-detection system.' },
  { label:'Blood', size:1.4, color:'#2a8a93', x:70, y:80, r:-2, slug:'hemophobia',
    headline:'You can stay steady at the sight of it.', body:'For many it\'s the fainting response, not panic. One session changes how your body reacts. (A physician referral is required for this one.)' },
  { label:'Doctors', size:1.5, color:'#1a6b72', x:14, y:24, r:-1, slug:'iatrophobia',
    headline:'Your health deserves your full attention.', body:'Fear of doctors keeps millions from the care they need. One session changes what appointments mean to your nervous system.' },
  { label:'Hospitals', size:1.4, color:'#c9a84c', x:42, y:30, r:2, slug:'nosocomephobia',
    headline:'A hospital is a place of help, not dread.', body:'For yourself or someone you love — one session changes what walking through those doors feels like.' },
  { label:'RSD', size:1.35, color:'#7a9e7e', x:88, y:36, r:-2, slug:'rejection-sensitive-dysphoria',
    headline:'When rejection lands like a physical blow.', body:'Often connected to ADHD. Intense, almost physical pain from perceived rejection. One session, alongside your physician. (A referral is required.)' },
  { label:'Dentists', size:1.5, color:'#2a8a93', x:60, y:16, r:2, slug:'dentophobia',
    headline:'Your smile deserves to be looked after.', body:'One of the most common fears — and one of the most successfully addressed in a single session. No dental imagery, no exposure.' },
  { label:'Crowds', size:1.45, color:'#1a6b72', x:30, y:88, r:-1, slug:'enochlophobia',
    headline:'The world is full of people. Join it.', body:'Fear of crowds removes concerts, cities, and shared experiences from your life. One session changes the response.' },
  { label:'Aging', size:1.3, color:'#c9a84c', x:6, y:14, r:1, slug:'gerascophobia',
    headline:'Every year is yours to live fully.', body:'Fear of aging steals the present by making the future feel like a threat. One session transforms that relationship.' },
  { label:'Mirrors', size:1.25, color:'#7a9e7e', x:80, y:8, r:-3, slug:'eisoptrophobia',
    headline:'You deserve to see yourself without fear.', body:'One session changes what your reflection means to your nervous system. No mirrors required.' },
  { label:'Being Stared At', size:1.3, color:'#2a8a93', x:48, y:42, r:2, slug:'scopophobia',
    headline:'You were meant to be seen — without fear.', body:'Being watched shrinks the world one avoided situation at a time. One session restores your natural ease in public.' },
  { label:'Decisions', size:1.3, color:'#1a6b72', x:88, y:74, r:-1, slug:'decidophobia',
    headline:'Your life is waiting for you to choose it.', body:'Fear of making decisions hands control of your life to chance. One session changes the paralysis.' },
  { label:'Eating in Public', size:1.25, color:'#c9a84c', x:14, y:90, r:1, slug:'deipnophobia',
    headline:'Food was always meant to be shared.', body:'Fear of eating in public removes lunches, dinners, and the social fabric of a shared life. One session, no restaurants required.' },
  { label:'Vomiting', size:1.15, color:'#7a9e7e', x:64, y:90, r:-2, slug:'emetophobia',
    headline:'Ease the worry that shapes your days.', body:'A quiet fear that reorganizes eating, travel, and daily life. One session, alongside your physician. (A referral is required.)' },
  { label:'Plants', size:1.05, color:'#2a8a93', x:34, y:58, r:2, slug:'botanophobia',
    headline:'Greenery was never the threat.', body:'When plants set you on edge, one session changes what they mean to your nervous system.' },
  { label:'Clowns', size:1.1, color:'#1a6b72', x:90, y:54, r:-2, slug:'coulrophobia',
    headline:'The painted face isn\'t the threat your fear believes.', body:'One session changes what clowns mean to your nervous system — no exposure, just words.' },
  { label:'Ferns', size:0.95, color:'#a09090', x:4, y:42, r:3, slug:'pteridophobia',
    headline:'Even the most unusual fear has a root.', body:'However rare the fear, it runs as the same kind of program — and the same approach addresses it. One session.' },
  { label:'Something else', size:1.6, color:'#7cb518', x:50, y:96, r:0, slug:'', standout:true,
    headline:'Whatever it is, it has a name.', body:'Not every fear fits a category. But every fear has a root — and every root can be addressed. Tell us in the free consultation.' },
];

var curiosities = [
  { label:'The Subconscious', size:2.1, color:'#1a6b72', x:5, y:8, r:-3, emoji:'🧠',
    title:'The subconscious is running most of the show.', body:'About 95% of your decisions, emotions, and behaviours are driven by the subconscious mind — not the conscious one. Hypnotherapy works directly with that 95%.',
    btns:[{label:'Learn how it works', fn:'curioCta(SITE + GENERAL_PAGE + "#process")'}] },
  { label:'Hypnosis', size:1.9, color:'#c9a84c', x:55, y:5, r:2, emoji:'✨',
    title:'Nothing like the movies.', body:'Clinical hypnotherapy is a deeply relaxing, fully conscious state of focused awareness. You remain in control throughout. No one clucks like a chicken unless they genuinely want to.',
    btns:[{label:'Free consultation', fn:'curioCta(SITE + GENERAL_PAGE)'}] },
  { label:'Law of Attraction', size:1.7, color:'#7a9e7e', x:3, y:48, r:-2, emoji:'🌱',
    title:'The mind moves toward what it believes.', body:'Whether you call it Law of Attraction, neuroplasticity, or expectation bias — the evidence is clear: the subconscious mind shapes perception, and perception shapes reality.',
    btns:[] },
  { label:'Self-Hypnosis', size:1.6, color:'#2a8a93', x:62, y:42, r:3, emoji:'🌊',
    title:'You can learn to do this yourself.', body:'Self-hypnosis is a learnable skill that allows you to access the relaxation response, manage anxiety, and begin reprogramming unhelpful patterns. Steven offers training for those who want to go deeper.',
    btns:[{label:'Ask about self-hypnosis training', fn:'curioCta(SITE + GENERAL_PAGE)'}] },
  { label:'Fear & the Brain', size:1.5, color:'#1a6b72', x:25, y:65, r:-1, emoji:'⚡',
    title:'Fear is a protection mechanism — not a character flaw.', body:'The amygdala fires before the prefrontal cortex can reason. That\'s why logic doesn\'t fix phobias. The fear response is subconscious, automatic, and can be updated at its source.',
    btns:[] },
  { label:'Therapies Available', size:1.4, color:'#c9a84c', x:60, y:72, r:2, emoji:'🗺️',
    title:'There are many paths. Not all are equal.', body:'CBT, ERP, EMDR, medication, exposure therapy, hypnotherapy — each has its place. For phobia release specifically, clinical hypnotherapy consistently produces faster, more lasting results than exposure-based approaches.',
    btns:[{label:'See how it works', fn:'curioCta(SITE + GENERAL_PAGE + "#process")'}] },
  { label:'Cats', size:1.3, color:'#7a9e7e', x:5, y:82, r:-4, emoji:'🐈',
    title:'Obviously.', body:'Cats have approximately 300 million neurons dedicated to sensory processing. They can hear frequencies humans can\'t. We\'re not saying they\'re psychic. We\'re just saying — watch the cat.',
    btns:[] },
];

var whys = [
  { label:'Purpose', size:2.0, color:'#1a6b72', x:5, y:10, r:-2, emoji:'🌟',
    title:'Perhaps you\'re looking for the next version of yourself.', body:'Purpose often announces itself quietly, through a restlessness, a sense that something could be different. You don\'t always need to name it to begin moving toward it.',
    btns:[{label:'Start a conversation', fn:'curioCta(SITE + GENERAL_PAGE)'}] },
  { label:'Healing', size:1.85, color:'#7a9e7e', x:60, y:8, r:3, emoji:'🌿',
    title:'Something brought you here. That matters.', body:'Healing rarely announces itself with fanfare. More often it\'s a quiet pull — toward a website you weren\'t planning to visit, a page you didn\'t expect to stay on.',
    btns:[{label:'Free consultation', fn:'curioCta(SITE + GENERAL_PAGE)'}] },
  { label:'Curiosity', size:1.7, color:'#2a8a93', x:3, y:52, r:-3, emoji:'✨',
    title:'The most underrated reason to be anywhere.', body:'Curiosity is how most important things begin. It doesn\'t need a destination. Follow it.',
    btns:[{label:'Explore', fn:'go("curious")'}] },
  { label:'Service', size:1.6, color:'#c9a84c', x:65, y:48, r:2, emoji:'💛',
    title:'You\'re thinking of someone else.', body:'Sometimes we wander in for someone we love, before we\'ve admitted that to ourselves.',
    btns:[{label:'I\'m here for someone', fn:'go("friend")'}] },
  { label:'Chance', size:1.45, color:'#1a6b72', x:22, y:72, r:-1, emoji:'🎲',
    title:'There are no wrong turns.', body:'Whatever brought you here — a search, a link, a conversation — you\'re here now. That\'s enough. Look around.',
    btns:[] },
  { label:'Connection', size:1.35, color:'#7a9e7e', x:62, y:74, r:3, emoji:'🤝',
    title:'Perhaps you\'re looking for something real.', body:'The internet is full of noise. This is a real person, doing real work, genuinely changing the lives of real people. Sometimes that\'s what we\'re looking for.',
    btns:[{label:'Meet Steven', fn:'curioCta(SITE + GENERAL_PAGE + "#guide")'}] },
  { label:'To give Steve money', size:1.15, color:'#c9a84c', x:5, y:86, r:-2, emoji:'💸',
    title:'Ha. Well — since you mention it.', body:'You absolute legend. As it happens, there is a very reasonable way to do exactly that — and you\'ll get something genuinely valuable in return.',
    btns:[{label:'Take my money, Steven', fn:'curioCta(SITE + "/payment.php")'}] },
  { label:'Procreation', size:1.0, color:'#a09090', x:68, y:86, r:4, emoji:'🔒',
    title:'Door\'s locked on that one.', body:'Steven is a certified clinical hypnotherapist. Wonderfully helpful for phobias. Less so for what you\'re apparently looking for. Try a different website.',
    btns:[] },
];

function buildCloud(containerId, items, clickFn) {
  var c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = '';
  var isMobile = window.matchMedia('(max-width: 926px)').matches;
  var placed = [];
  var W = c.clientWidth  || 600;
  var H = c.clientHeight || 420;
  if (W < 120) W = 600;
  if (H < 120) H = 420;
  var fontMul = Math.max(11, Math.min(16, H / 32));

  function collides(x, y, box) {
    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      if (Math.abs(x - p.x) < (box.w + p.w) / 2 + 2.5 &&
          Math.abs(y - p.y) < (box.h + p.h) / 2 + 3.0) return true;
    }
    return false;
  }
  function findSpot(box) {
    for (var attempt = 0; attempt < 1200; attempt++) {
      var x = box.w/2 + 1 + Math.random() * (100 - box.w - 2);
      var y = box.h/2 + 1 + Math.random() * (100 - box.h - 2);
      if (!collides(x, y, box)) return { x: x, y: y };
    }
    return null;
  }

  var ordered = items.slice().sort(function(a, b){
    if (a.standout) return -1;
    if (b.standout) return 1;
    return b.size - a.size;
  });

  ordered.forEach(function(f) {
    var el = document.createElement('span');
    el.className = containerId === 'fear-cloud' ? 'fear-word' : containerId === 'curiosity-map' ? 'curio-word' : 'why-word';
    if (f.size >= 2.3)       el.className += ' tier1';
    else if (f.size >= 1.75) el.className += ' tier2';
    else if (f.size < 1.2)   el.className += ' tier4';
    if (f.standout)          el.className += ' standout';
    el.textContent = f.label;
    el.style.fontSize = (f.size * fontMul) + 'px';
    el.style.color = f.color;
    el.style.opacity = f.standout ? '1' : (f.size > 1.8 ? '0.95' : f.size > 1.4 ? '0.78' : '0.62');
    el.style.fontWeight = f.standout ? '600' : (f.size > 2 ? '400' : '300');
    el.addEventListener('click', function() { clickFn(f); });

    if (isMobile) { c.appendChild(el); return; }

    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.style.top  = '-9999px';
    c.appendChild(el);
    var r = el.getBoundingClientRect();
    var box = { w: (r.width / W) * 100, h: (r.height / H) * 100 };

    if (f.standout) {
      el.style.left = '50%';
      el.style.top  = (100 - box.h/2 - 1) + '%';
      el.style.transform = 'translate(-50%, -50%)';
      placed.push({ x: 50, y: 100 - box.h/2 - 1, w: box.w, h: box.h });
      return;
    }

    var spot = findSpot(box);
    if (spot) {
      el.style.left = spot.x + '%';
      el.style.top  = spot.y + '%';
      el.style.transform = 'translate(-50%, -50%) rotate(' + f.r + 'deg)';
      placed.push({ x: spot.x, y: spot.y, w: box.w, h: box.h });
    } else {
      c.removeChild(el);
    }
  });
}


// go() for standalone page use — navigates to the page directly.
// When loaded via AJAX into index.php, index.php's go() overrides this.
function go(scene) {
  if (scene === 'welcome') scene = 'home';
  window.location.href = '/welcome-' + scene + '.php';
}