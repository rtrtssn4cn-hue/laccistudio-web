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
  if (cfg.hoursWeekday)  setText('.js-hours-weekday',  cfg.hoursWeekday);
  if (cfg.hoursSaturday) setText('.js-hours-saturday', cfg.hoursSaturday);
  if (cfg.hoursSunday)   setText('.js-hours-sunday',   cfg.hoursSunday);
  setText('.js-foot-hours-weekday', 'Mon–Fri: ' + (cfg.hoursWeekday || 'By appointment'));
  setText('.js-foot-hours-sunday',  'Sun: ' + (cfg.hoursSunday || 'Closed'));
  // Social links (hide icon if no URL provided)
  [['instagram', '.js-instagram'], ['facebook', '.js-facebook'], ['etsy', '.js-etsy']].forEach(function (pair) {
    var url = cfg[pair[0]];
    document.querySelectorAll(pair[1]).forEach(function (a) {
      if (url) { a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      else { a.style.display = 'none'; }
    });
  });

  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); });
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
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = new FormData(form);
      var name = (data.get('name') || '').toString().trim();
      var email = (data.get('email') || '').toString().trim();
      var service = (data.get('service') || '').toString();
      var qty = (data.get('quantity') || '').toString();
      var msg = (data.get('message') || '').toString();
      var body = encodeURIComponent(
        'Name: ' + name + '\n' +
        'Email: ' + email + '\n' +
        'Service: ' + service + '\n' +
        'Estimated quantity: ' + qty + '\n\n' +
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
