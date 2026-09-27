/* Homepage "Featured Gifts": at most 3 products that are both Available (boot.js only passes active
   products) and Featured (the Admin's Featured switch). Nothing featured = the section stays hidden,
   so Home never becomes a copy of the Shop. Also swaps the hero logo card for a real product photo
   when content/home.json has "heroImage". */
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fromPrice(p) {
    var priced = [];
    (p.optionGroups || []).forEach(function (g) { (g.choices || []).forEach(function (c) { if (c && c.price != null) priced.push(c); }); });
    if (!priced.length) return "$" + Number(p.price).toFixed(2);
    return "from $" + Math.min.apply(null, priced.map(function (c) { return c.price; })).toFixed(2);
  }
  // Same small JPEG card copy the shop grid uses; falls back to the original image.
  function card(src) { return String(src).replace(/^(https?:\/\/[^\/]+)?\/?assets\/img\/mock\/([\w-]+)\.png(\?.*)?$/, "/assets/img/card/$2.jpg"); }
  function run() {
    var box = document.querySelector("#home-popular"), grid = document.querySelector("#home-popular-grid");
    var shop = window.LACCI_SHOP;
    if (!box || !grid || !shop) return;
    var raw = (window.LACCI_RAW && window.LACCI_RAW.products) || [];
    var featured = function (p) { var r = raw.find(function (x) { return x.id === p.id; }); return !!(r && r.featured === true); };
    var list = (shop.products || []).filter(function (p) { return p.image && featured(p); }).slice(0, 3);
    if (!list.length) return;
    grid.innerHTML = list.map(function (p) {
      return '<article class="prod-card reveal in"><a href="shop.html" class="prod-media" style="display:block"><div class="pslide active"><img class="prod-mockphoto" src="' + esc(card(p.image)) + '" onerror="this.onerror=null;this.src=\'' + esc(p.image).replace(/'/g, "%27") + '\'" alt="' + esc(p.name) + '" loading="lazy"></div></a>' +
        '<div class="prod-body"><h3>' + esc(p.name) + '</h3><div class="prod-foot"><span class="prod-price">' + fromPrice(p) + '</span></div>' +
        '<a href="shop.html#personalize=' + encodeURIComponent(p.id) + '" class="btn btn-gold">Personalize</a></div></article>';
    }).join("");
    box.hidden = false;
  }
  function heroPhoto() {
    var box = document.querySelector("#hero-visual"); if (!box) return;
    fetch("/content/home.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (h) {
      if (!h || typeof h.heroImage !== "string" || !/^(\/|https:\/\/)/.test(h.heroImage)) return;
      var img = new Image();
      img.onload = function () { box.classList.add("hero-photo"); box.replaceChildren(img); };
      img.alt = h.heroImageAlt || "Personalized gift made by Lacci Studio";
      img.src = h.heroImage;
    }).catch(function () {});
  }
  heroPhoto();
  if (window.LACCI_READY) run(); else document.addEventListener("lacci:ready", run, { once: true });
})();
