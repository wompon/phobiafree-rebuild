// ─── SECTION REORDER LISTENER ───
// This script handles postMessage commands from the admin reorder page
(function() {

  var sectionIds = ['hero','aspirational','problem','guide','process','differentiator','testimonials','faq','failure','success','final-cta'];

  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.action) return;

    if (e.data.action === 'reorder' && e.data.order) {
      reorderSections(e.data.order);
    }

    if (e.data.action === 'highlight' && e.data.section) {
      highlightSection(e.data.section);
    }

    if (e.data.action === 'clearHighlight') {
      clearHighlight();
    }
  });

  function reorderSections(order) {
    // Find a common parent — the body or a main wrapper
    var first = document.getElementById(order[0]);
    if (!first) return;
    var parent = first.parentNode;

    // Move each section to the correct position
    order.forEach(function(sid) {
      var el = document.getElementById(sid);
      if (el) parent.appendChild(el);
    });
  }

  function highlightSection(sid) {
    clearHighlight();
    var el = document.getElementById(sid);
    if (!el) return;
    el.style.outline = '3px solid #1a6b72';
    el.style.outlineOffset = '-3px';
    // Report position to parent
    var rect = el.getBoundingClientRect();
    window.parent.postMessage({
      action: 'sectionPos',
      section: sid,
      top: rect.top + window.scrollY,
      height: rect.height
    }, '*');
  }

  function clearHighlight() {
    sectionIds.forEach(function(sid) {
      var el = document.getElementById(sid);
      if (el) {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }
    });
    window.parent.postMessage({action:'clearHighlight'}, '*');
  }

})();
