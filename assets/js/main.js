/* Lacci Studio — site interactions */
(function () {
  function run() {
  // ---- Apply contact info from settings (loaded by boot.js) everywhere ----
  var cfg = window.LACCI_CONFIG || {};
  function setText(sel, val) {
    document.querySelectorAll(sel).forEach(function (el) { el.textContent = val; });
  }
  if (cfg.email) {
    document.querySelectorAll('.js-email').forEach(function (a) {
      a.textContent = cfg.email;
      a.setAttribute('href', 'mailto:' + cfg.email);
    });
    var form = document.querySelector('#inquiry-form');
    if (form) form.setAttribute('data-to', cfg.email);
  }
  // Phone (hide the whole row if empty)
  document.querySelectorAll('.js-phone').forEach(function (el) {
    if (cfg.phone) { el.textContent = cfg.phone; }
    else { var row = el.closest('.info-item') || el; row.style.display = 'none'; }
  });
  // Hours
  // Social links (hide icon if no URL provided)
  // Social links (hide icon if no URL provided).
  // Accepts a full URL or a bare @handle / username.
  var SOCIAL_BASE = {
    instagram: 'https://instagram.com/',
    facebook:  'https://facebook.com/',
    etsy:      'https://www.etsy.com/shop/',
    tiktok:    'https://www.tiktok.com/@',
    pinterest: 'https://pinterest.com/',
    youtube:   'https://youtube.com/@'
  };
  function socialUrl(net, val) {
    if (!val) return '';
    val = String(val).trim();
    if (/^https?:\/\//i.test(val)) return val;
    return SOCIAL_BASE[net] + val.replace(/^@/, '');
  }
  [['instagram', '.js-instagram'], ['facebook', '.js-facebook'], ['etsy', '.js-etsy'],
   ['tiktok', '.js-tiktok'], ['pinterest', '.js-pinterest'], ['youtube', '.js-youtube']
  ].forEach(function (pair) {
    var url = socialUrl(pair[0], cfg[pair[0]]);
    document.querySelectorAll(pair[1]).forEach(function (a) {
      if (url) { a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      else { a.style.display = 'none'; }
    });
  });

  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', function () {
      toggle.setAttribute('aria-expanded', links.classList.toggle('open') ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); });
    });
  }

  // Header shadow on scroll
  var header = document.querySelector('.site-header');
  function onScroll() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 10);
  }
  window.addEventListener('scroll', onScroll);
  onScroll();

  // Reveal on scroll
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // Current year
  var y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();

  // Inquiry form (front-end demo — no backend). Opens a prefilled email.
  var form = document.querySelector('#inquiry-form');
  if (form) {
    // Arriving from a product (large order): fill in what we know. Dates before today aren't offered.
    try {
      var q = new URLSearchParams(location.search);
      var sel = form.querySelector('#service'), want = q.get('service');
      if (sel && want) [].forEach.call(sel.options, function (o) { if (o.text === want) sel.value = o.value || o.text; });
      if (q.get('item') && form.querySelector('#item')) form.querySelector('#item').value = q.get('item').slice(0, 120);
      if (q.get('quantity') && form.querySelector('#quantity')) form.querySelector('#quantity').value = q.get('quantity').slice(0, 20);
      var nd = form.querySelector('#needed'); if (nd) nd.min = new Date().toISOString().slice(0, 10);
    } catch (e) {}
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = new FormData(form);
      var name = (data.get('name') || '').toString().trim();
      var email = (data.get('email') || '').toString().trim();
      var service = (data.get('service') || '').toString();
      var qty = (data.get('quantity') || '').toString();
      var item = (data.get('item') || '').toString();
      var needed = (data.get('needed') || '').toString();
      var msg = (data.get('message') || '').toString();
      var body = encodeURIComponent(
        'Name: ' + name + '\n' +
        'Email: ' + email + '\n' +
        'Service: ' + service + '\n' +
        'Product: ' + item + '\n' +
        'Estimated quantity: ' + qty + '\n' +
        'Needed by: ' + (needed || 'not given') + '\n\n' +
        'Project details:\n' + msg
      );
      var subject = encodeURIComponent('Custom Order Inquiry — ' + (service || 'Lacci Studio'));
      var to = form.getAttribute('data-to') || 'info@laccistudio.com';
      var success = document.querySelector('.form-success');
      if (success) success.classList.add('show');
      window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
    });
  }
  }
  if (window.LACCI_READY) run();
  else document.addEventListener("lacci:ready", run, { once: true });
})();
