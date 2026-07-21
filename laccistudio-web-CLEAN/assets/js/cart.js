/* =========================================================================
   Lacci Studio — Shop + Cart engine
   Compact grid + category filters + personalization & design upload (in cart)
   Reads products & checkout settings from assets/js/shop-config.js
   ========================================================================= */
(function () {
  function run() {
  var SHOP = window.LACCI_SHOP;
  if (!SHOP) return;
  var CO = SHOP.checkout || {};
  var MODE = CO.mode || "inquiry";
  var SYM = SHOP.currencySymbol || "$";
  var CUR = SHOP.currency || "USD";
  var KEY = "lacci_cart_v2";
  var SNIPCART = (MODE === "snipcart" && CO.snipcartApiKey);
  var UC = CO.uploadcarePublicKey || ""; // Uploadcare public key for customer design uploads

  var FILES = {}; // in-memory design files this session, keyed by line key
  var money = function (n) { return SYM + Number(n).toFixed(2); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  /* ------------------------------ storage ------------------------------ */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  var cart = load();
  function lineKey(id, opt) { return id + "::" + (opt || ""); }
  function count() { return cart.reduce(function (s, i) { return s + i.qty; }, 0); }
  function subtotal() { return cart.reduce(function (s, i) { return s + i.qty * i.price; }, 0); }
  function findProduct(id) { return (SHOP.products || []).find(function (p) { return p.id === id; }); }
  // Options may be plain strings OR { name, price } objects for per-size pricing
  function choicesOf(p) { return (p && p.options && p.options.choices) ? p.options.choices : []; }
  function choiceName(c) { return (c && typeof c === "object") ? c.name : c; }
  function firstChoiceName(p) { var cs = choicesOf(p); return cs.length ? choiceName(cs[0]) : ""; }
  function priceFor(p, opt) {
    var cs = choicesOf(p);
    for (var i = 0; i < cs.length; i++) { var c = cs[i]; if (typeof c === "object" && c.name === opt && c.price != null) return c.price; }
    return p.price;
  }
  function priceLabelFor(p) {
    var priced = choicesOf(p).filter(function (c) { return typeof c === "object" && c.price != null; });
    if (priced.length) { var m = Math.min.apply(null, priced.map(function (c) { return c.price; })); return "from " + money(m); }
    return money(p.price);
  }
  // Price change a single choice applies. `price` = absolute unit price; `add` = flat surcharge.
  function choiceMod(p, c) {
    if (c && typeof c === "object") {
      if (c.price != null && c.price !== "") return Number(c.price) - Number(p.price);
      if (c.add != null && c.add !== "") return Number(c.add);
    }
    return 0;
  }
  // One Snipcart option token with price modifier, e.g. "Set of 4[+16.00]" or "2XL[+2.00]"
  function snipToken(p, c) {
    var m = choiceMod(p, c);
    return choiceName(c) + (m ? "[" + (m > 0 ? "+" : "") + m.toFixed(2) + "]" : "");
  }
  function groupsOf(p) { return (p && p.optionGroups && p.optionGroups.length) ? p.optionGroups : (p && p.options ? [p.options] : []); }

  function addItem(id, opt) {
    var p = findProduct(id); if (!p) return;
    var k = lineKey(id, opt);
    var line = cart.find(function (i) { return lineKey(i.id, i.option) === k; });
    if (line) line.qty += 1;
    else cart.push({ id: id, name: p.name, price: priceFor(p, opt), image: p.image, option: opt || "", note: "", design: "", qty: 1 });
    save(cart); render(); openDrawer();
  }
  function setQty(k, q) {
    var line = cart.find(function (i) { return lineKey(i.id, i.option) === k; });
    if (!line) return;
    line.qty = q;
    if (line.qty <= 0) { cart = cart.filter(function (i) { return lineKey(i.id, i.option) !== k; }); delete FILES[k]; }
    save(cart); render();
  }

  /* ------------------------------ filters ------------------------------ */
  function renderFilters() {
    var bar = document.querySelector("#shop-filters");
    if (!bar) return;
    var cats = [];
    (SHOP.products || []).forEach(function (p) { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
    var btns = ['<button class="filter-btn active" data-filter="all">All</button>']
      .concat(cats.map(function (c) { return '<button class="filter-btn" data-filter="' + esc(c) + '">' + esc(c) + "</button>"; }));
    bar.innerHTML = btns.join("");
    bar.querySelectorAll(".filter-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        bar.querySelectorAll(".filter-btn").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        var f = b.getAttribute("data-filter");
        document.querySelectorAll(".prod-card").forEach(function (card) {
          var show = (f === "all") || (card.getAttribute("data-category") === f);
          card.classList.toggle("hide", !show);
        });
      });
    });
  }

  /* --------------------------- product media carousel --------------------------- */
  function mediaHTML(p) {
    // Slideshow of example-design photos (first photo = cover). Falls back to the mockup, then line-art.
    var imgs = (p.images && p.images.length) ? p.images : (p.mockupPhoto ? [p.mockupPhoto] : []);
    var slides = imgs.length
      ? imgs.map(function (src, i) {
          return '<div class="pslide' + (i === 0 ? " active" : "") + '"><img class="prod-mockphoto" src="' + esc(src) + '" alt="' + esc(p.name) + '" loading="lazy"></div>';
        })
      : ['<div class="pslide active"><div class="prod-mock">' + mockupSVG(p) + "</div></div>"];
    if (p.video) {
      slides.push('<div class="pslide"><video src="' + esc(p.video) + '" muted loop playsinline preload="metadata"></video><span class="pvid-badge">▶ Video</span></div>');
    }
    var n = slides.length;
    var controls = "";
    if (n > 1) {
      var dots = "";
      for (var i = 0; i < n; i++) dots += '<span class="pdot' + (i === 0 ? " on" : "") + '" data-d="' + i + '"></span>';
      controls = '<button class="pnav prev" aria-label="Previous photo">‹</button>' +
        '<button class="pnav next" aria-label="Next photo">›</button>' +
        '<div class="pdots">' + dots + "</div>";
    }
    return '<div class="prod-media" data-idx="0">' + slides.join("") +
      (p.category ? '<span class="prod-tag">' + esc(p.category) + "</span>" : "") +
      controls + "</div>";
  }
  function setupCarousels(grid) {
    grid.querySelectorAll(".prod-media").forEach(function (media) {
      var slides = media.querySelectorAll(".pslide");
      if (slides.length < 2) return;
      var dots = media.querySelectorAll(".pdot");
      function show(n) {
        var cur = parseInt(media.getAttribute("data-idx") || "0", 10);
        var prevVid = slides[cur].querySelector("video"); if (prevVid) prevVid.pause();
        n = (n + slides.length) % slides.length;
        slides.forEach(function (s, i) { s.classList.toggle("active", i === n); });
        dots.forEach(function (d, i) { d.classList.toggle("on", i === n); });
        media.setAttribute("data-idx", n);
        var vid = slides[n].querySelector("video"); if (vid) { vid.play().catch(function () {}); }
      }
      var prev = media.querySelector(".pnav.prev");
      var next = media.querySelector(".pnav.next");
      if (prev) prev.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); show(parseInt(media.getAttribute("data-idx") || "0", 10) - 1); });
      if (next) next.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); show(parseInt(media.getAttribute("data-idx") || "0", 10) + 1); });
      dots.forEach(function (d) { d.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); show(parseInt(d.getAttribute("data-d"), 10)); }); });
      // swipe on touch
      var x0 = null;
      media.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      media.addEventListener("touchend", function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) show(parseInt(media.getAttribute("data-idx") || "0", 10) + (dx < 0 ? 1 : -1));
        x0 = null;
      });
    });
  }

  /* --------------------------- quick view modal --------------------------- */
  function injectQuickView() {
    if (SNIPCART) return;
    if (document.querySelector("#qv-modal")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="qv-overlay" id="qv-overlay"></div>' +
      '<div class="qv-modal" id="qv-modal" role="dialog" aria-modal="true" aria-label="Product details">' +
        '<button class="qv-close" aria-label="Close">&times;</button>' +
        '<div class="qv-media" id="qv-media"></div>' +
        '<div class="qv-info" id="qv-info"></div>' +
      "</div>";
    document.body.appendChild(wrap);
    document.querySelector("#qv-overlay").addEventListener("click", closeQuickView);
    document.querySelector(".qv-close").addEventListener("click", closeQuickView);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeQuickView(); });
  }
  function closeQuickView() {
    var m = document.querySelector("#qv-modal"), o = document.querySelector("#qv-overlay");
    if (m) { m.classList.remove("show"); m.querySelectorAll("video").forEach(function (v) { v.pause(); }); }
    if (o) o.classList.remove("show");
  }
  function openQuickView(p) {
    var media = document.querySelector("#qv-media");
    var info = document.querySelector("#qv-info");
    if (!media || !info) return;
    media.innerHTML = mediaHTML(p);
    var opts = "";
    if (p.options && p.options.choices && p.options.choices.length) {
      opts = '<label class="qv-opt"><span>' + esc(p.options.label || "Option") + '</span>' +
        '<select id="qv-select">' + p.options.choices.map(function (c) {
          var nm = choiceName(c);
          var pr = (typeof c === "object" && c.price != null) ? " — " + money(c.price) : "";
          return "<option>" + esc(nm) + pr + "</option>";
        }).join("") + "</select></label>";
    }
    info.innerHTML =
      (p.category ? '<span class="qv-cat">' + esc(p.category) + "</span>" : "") +
      "<h3>" + esc(p.name) + "</h3>" +
      '<div class="qv-price" id="qv-price">' + priceLabelFor(p) + "</div>" +
      '<p class="qv-desc">' + esc(p.description || "") + "</p>" +
      opts +
      '<label class="qv-opt"><span>Personalization (optional)</span><input type="text" id="qv-note" placeholder="Name, initials, or text"></label>' +
      '<button class="btn btn-gold" id="qv-add" style="width:100%;justify-content:center;margin-top:.4rem">Add to Cart</button>' +
      '<p class="qv-hint">Add your photo/logo &amp; more details in the cart at checkout.</p>';
    // live price on option change
    var sel = info.querySelector("#qv-select");
    if (sel) sel.addEventListener("change", function () {
      var nm = sel.value.split(" — ")[0];
      document.querySelector("#qv-price").textContent = money(priceFor(p, nm));
    });
    info.querySelector("#qv-add").addEventListener("click", function () {
      var opt = sel ? sel.value.split(" — ")[0] : firstChoiceName(findProduct(p.id));
      var note = (info.querySelector("#qv-note") || {}).value || "";
      addItem(p.id, opt);
      if (note) { var k = lineKey(p.id, opt); var l = cart.find(function (i) { return lineKey(i.id, i.option) === k; }); if (l) { l.note = note.trim(); save(cart); render(); } }
      closeQuickView();
    });
    setupCarousels(document.querySelector("#qv-modal"));
    document.querySelector("#qv-overlay").classList.add("show");
    document.querySelector("#qv-modal").classList.add("show");
  }

  /* --------------------------- shop grid page --------------------------- */
  function renderGrid() {
    var grid = document.querySelector("#shop-grid");
    if (!grid) return;
    grid.innerHTML = (SHOP.products || []).map(function (p) {
      var btn = SNIPCART
        ? '<button class="btn btn-gold js-customize" data-cz="' + esc(p.id) + '">Add to Cart</button>'
        : '<button class="btn btn-gold js-add" data-add="' + esc(p.id) + '">Add to Cart</button>';
      return '<article class="prod-card reveal in" data-category="' + esc(p.category || "") + '" title="' + esc(p.description || "") + '">' +
        mediaHTML(p) +
        '<div class="prod-body">' +
        '<h3>' + esc(p.name) + "</h3>" +
        '<div class="prod-foot"><span class="prod-price">' + priceLabelFor(p) + "</span></div>" +
        btn + "</div></article>";
    }).join("");

    if (SNIPCART) {
      grid.querySelectorAll(".js-customize").forEach(function (b) {
        b.addEventListener("click", function () { openCustomize(findProduct(b.getAttribute("data-cz"))); });
      });
    } else {
      grid.querySelectorAll(".js-add").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-add");
          addItem(id, firstChoiceName(findProduct(id)));
        });
      });
    }
    setupCarousels(grid);
    if (!SNIPCART) {
      grid.querySelectorAll(".prod-card").forEach(function (card) {
        var addBtn = card.querySelector(".js-add"); if (!addBtn) return;
        var pid = addBtn.getAttribute("data-add");
        var media = card.querySelector(".prod-media");
        if (media) { media.style.cursor = "pointer"; media.addEventListener("click", function () { openQuickView(findProduct(pid)); }); }
      });
    } else {
      grid.querySelectorAll(".prod-card").forEach(function (card) {
        var addBtn = card.querySelector(".js-customize"); if (!addBtn) return;
        var pid = addBtn.getAttribute("data-cz");
        var media = card.querySelector(".prod-media");
        if (media) { media.style.cursor = "pointer"; media.addEventListener("click", function () { openCustomize(findProduct(pid)); }); }
      });
    }
  }

  /* --------------------- customize modal (Snipcart add-to-cart) --------------------- */
  // Global choice lists (apply to every product)
  var FONTS = ["No preference", "Script / Cursive", "Serif / Classic", "Sans-serif / Modern", "Handwritten", "Bold / Block", "Monogram", "Match my sample (note below)"];
  var COLORS = ["No preference", "White", "Black", "Gold", "Silver", "Rose Gold", "Red", "Navy", "Pink", "Green", "Custom (note below)"];
  var PROOF = ["Yes — email me a proof to approve first (recommended)", "No proof needed — I trust your design"];
  var TIMELINE = ["Standard (2–3 weeks)", "Needed within 2 weeks", "Rush — I'll message you"];
  var GLOBAL_PRE = [{ name: "Font style", options: FONTS }, { name: "Color", options: COLORS }];
  var GLOBAL_POST = [{ name: "Proof approval", options: PROOF }, { name: "Timeline", options: TIMELINE }];
  function fontCSS(name) {
    if (/Script|Handwritten/.test(name)) return "'Pinyon Script', cursive";
    if (/Sans/.test(name)) return "'Montserrat', sans-serif";
    if (/Bold|Block/.test(name)) return "'Montserrat', sans-serif";
    return "'Cormorant Garamond', serif";
  }
  function colorCSS(name) {
    var m = { "White": "#ffffff", "Black": "#141414", "Gold": "#D79D41", "Silver": "#c9c9c9", "Rose Gold": "#b76e79", "Red": "#c0392b", "Navy": "#1f3a5f", "Pink": "#e79bb0", "Green": "#2e7d54" };
    return m[name] || "#D79D41";
  }
  // Blank product silhouettes for the live mockup. Each returns inner SVG markup on a 0 0 120 100 canvas.
  var SHAPES = {
    shirt: '<path d="M46 16 54 10 Q60 17 66 10 L74 16 92 26 84 40 78 35 78 90 42 90 42 35 36 40 28 26Z"/><path d="M54 10 Q60 20 66 10" fill="none"/>',
    hoodie: '<path d="M46 22 54 16 Q60 23 66 16 L74 22 92 32 84 46 78 41 78 90 42 90 42 41 36 46 28 32Z"/><path d="M50 16 Q60 32 70 16" fill="none"/><path d="M50 68 70 68 66 82 54 82Z" fill="none"/>',
    tank: '<path d="M50 14 54 12 57 22 Q60 25 63 22 L66 12 70 14 73 36 69 36 69 90 51 90 51 36 47 36Z"/>',
    cap: '<path d="M30 56 Q30 30 60 30 Q90 30 90 56Z"/><path d="M30 56 14 62 Q12 68 20 68 L60 60Z"/><circle cx="60" cy="30" r="2.5" stroke="none" fill="#c4b6a3"/>',
    tote: '<rect x="34" y="36" width="52" height="54" rx="3"/><path d="M46 36 Q46 20 60 20 Q74 20 74 36" fill="none" stroke-width="3"/>',
    apron: '<path d="M48 20 72 20 72 30 Q84 36 84 48 L84 90 36 90 36 48 Q36 36 48 30Z"/><path d="M48 20 Q60 12 72 20" fill="none"/>',
    tumbler: '<path d="M44 22 76 22 72 90 48 90Z"/><rect x="42" y="13" width="36" height="10" rx="4"/>',
    mug: '<rect x="34" y="28" width="42" height="50" rx="6"/><path d="M76 40 q18 0 18 15 q0 15 -18 15" fill="none" stroke-width="5"/>',
    round: '<circle cx="60" cy="52" r="36"/>',
    board: '<rect x="26" y="18" width="68" height="70" rx="12"/><circle cx="60" cy="29" r="3.5"/>',
    ornament: '<line x1="60" y1="10" x2="60" y2="20" stroke-width="1.5"/><rect x="55" y="18" width="10" height="9" rx="2"/><circle cx="60" cy="58" r="31"/>',
    sticker: '<rect x="28" y="24" width="64" height="56" rx="12" stroke-dasharray="6 4"/>',
    gift: '<rect x="30" y="40" width="60" height="46" rx="3"/><rect x="30" y="40" width="60" height="13"/><line x1="60" y1="40" x2="60" y2="86"/><path d="M60 40 Q50 28 42 34 Q40 42 60 40 Q80 42 78 34 Q70 28 60 40" fill="none"/>'
  };
  function mockupType(p) {
    var n = (p.name || "").toLowerCase(), id = p.id || "";
    if (p.category === "Apparel") {
      if (/hoodie/.test(n)) return "hoodie";
      if (/tank/.test(n)) return "tank";
      if (/cap|hat|beanie/.test(n)) return "cap";
      if (/tote/.test(n)) return "tote";
      if (/apron/.test(n)) return "apron";
      return "shirt";
    }
    if (id === "sublimation-tumbler" || /tumbler|bottle/.test(n)) return "tumbler";
    if (id === "sublimation-mug" || /mug/.test(n)) return "mug";
    if (id === "ceramic-coasters" || /coaster/.test(n)) return "round";
    if (id === "engraved-board" || /board/.test(n)) return "board";
    if (id === "personalized-ornament" || /ornament/.test(n)) return "ornament";
    if (id === "custom-stickers" || /sticker|decal/.test(n)) return "sticker";
    return "gift";
  }
  function mockupSVG(p) {
    return '<svg viewBox="0 0 120 100" fill="#ffffff" stroke="#c4b6a3" stroke-width="2" stroke-linejoin="round">' + (SHAPES[mockupType(p)] || SHAPES.gift) + "</svg>";
  }
  // Canonical field order: Personalization, Font, Color, option groups, Design, Proof, Timeline, Comments.
  function customFieldDefs(p) {
    var defs = [{ name: "Personalization", type: "textarea" }];
    GLOBAL_PRE.forEach(function (g) { defs.push({ name: g.name, type: "dropdown", options: g.options.join("|") }); });
    groupsOf(p).forEach(function (g) {
      defs.push({ name: g.label, type: "dropdown", options: g.choices.map(function (c) { return snipToken(p, c); }).join("|") });
    });
    defs.push({ name: "Design file", type: "hidden" });
    GLOBAL_POST.forEach(function (g) { defs.push({ name: g.name, type: "dropdown", options: g.options.join("|") }); });
    defs.push({ name: "Comments", type: "textarea" });
    return defs;
  }
  function valueFor(name, v) {
    var map = { "Personalization": v.personalization, "Font style": v.font, "Color": v.color, "Design file": v.design, "Proof approval": v.proof, "Timeline": v.timeline, "Comments": v.comments };
    if (map[name] !== undefined) return map[name];
    if (v.options && v.options[name] !== undefined) return v.options[name];
    return "";
  }
  // Add an item to Snipcart with all chosen values by building & clicking a hidden button.
  function snipAdd(p, v) {
    var b = document.createElement("button");
    b.className = "snipcart-add-item"; b.style.display = "none";
    b.setAttribute("data-item-id", p.id);
    b.setAttribute("data-item-name", p.name);
    b.setAttribute("data-item-price", Number(p.price).toFixed(2));
    b.setAttribute("data-item-url", "/snipcart-products.html");
    b.setAttribute("data-item-image", p.image || "");
    b.setAttribute("data-item-description", p.description || "");
    b.setAttribute("data-item-quantity", String(v.qty || 1));
    customFieldDefs(p).forEach(function (d, i) {
      var pre = "data-item-custom" + (i + 1) + "-";
      b.setAttribute(pre + "name", d.name);
      if (d.type === "dropdown") b.setAttribute(pre + "options", d.options);
      else b.setAttribute(pre + "type", d.type);
      var val = valueFor(d.name, v);
      if (val) b.setAttribute(pre + "value", val);
    });
    document.body.appendChild(b);
    b.click();
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 900);
  }
  function unitPrice(p, selected) {
    var total = Number(p.price);
    groupsOf(p).forEach(function (g) {
      var chosen = null, token = selected[g.label];
      g.choices.forEach(function (c) { if (snipToken(p, c) === token) chosen = c; });
      if (!chosen && g.choices.length) chosen = g.choices[0];
      if (chosen) total += choiceMod(p, chosen);
    });
    return total;
  }
  function injectCustomizeModal() {
    if (!SNIPCART || document.querySelector("#cz-modal")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="cz-overlay" id="cz-overlay"></div>' +
      '<div class="cz-modal" id="cz-modal" role="dialog" aria-modal="true" aria-label="Customize product">' +
        '<button class="cz-close" aria-label="Close">&times;</button>' +
        '<div class="cz-body" id="cz-body"></div>' +
      "</div>";
    document.body.appendChild(wrap);
    document.querySelector("#cz-overlay").addEventListener("click", closeCustomize);
    document.querySelector(".cz-close").addEventListener("click", closeCustomize);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCustomize(); });
  }
  function closeCustomize() {
    var m = document.querySelector("#cz-modal"), o = document.querySelector("#cz-overlay");
    if (m) m.classList.remove("show"); if (o) o.classList.remove("show");
  }
  function dropdownHTML(label, id, options, cls) {
    return '<label class="cz-field"><span>' + esc(label) + '</span><select id="' + id + '"' + (cls ? ' class="' + cls + '"' : "") + '>' +
      options.map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select></label>";
  }
  function openCustomize(p) {
    if (!p) return;
    var body = document.querySelector("#cz-body"); if (!body) return;
    var state = { design: "" };
    var groups = groupsOf(p);
    var groupsHTML = groups.map(function (g) {
      return '<label class="cz-field"><span>' + esc(g.label) + '</span><select class="cz-opt" data-label="' + esc(g.label) + '">' +
        g.choices.map(function (c) {
          var m = choiceMod(p, c);
          var tag = m ? " — " + money(Number(p.price) + m) : "";
          return '<option value="' + esc(snipToken(p, c)) + '">' + esc(choiceName(c)) + esc(tag) + "</option>";
        }).join("") + "</select></label>";
    }).join("");
    var uploadHTML = UC ?
      '<div class="cz-field"><span>Upload your design, photo, or logo (optional)</span>' +
      '<input type="file" id="cz-file" accept="image/*,.pdf,.svg,.ai,.psd,.eps,.heic" style="display:none">' +
      '<button type="button" class="btn btn-ghost-gold" id="cz-upload" style="width:100%;justify-content:center">＋ Choose file</button>' +
      '<div class="cz-preview" id="cz-preview"></div>' +
      '<span class="up-status" id="cz-upstatus"></span></div>' : "";
    body.innerHTML =
      (p.category ? '<span class="qv-cat">' + esc(p.category) + "</span>" : "") +
      "<h3>" + esc(p.name) + "</h3>" +
      '<div class="cz-price" id="cz-price">' + money(unitPrice(p, {})) + "</div>" +
      '<p class="cz-desc">' + esc(p.description || "") + "</p>" +
      '<div class="cz-mockup" id="cz-mockup"><span class="cz-mock-tag">Live preview · drag to position</span>' +
        '<div class="cz-mock-inner" id="cz-mock-inner">' +
          (p.mockupPhoto ? '<img class="cz-mock-base cz-mock-photo" id="cz-mock-baseimg" src="' + esc(p.mockupPhoto) + '" alt="">' : '<div class="cz-mock-base">' + mockupSVG(p) + '</div>') +
          '<img class="cz-mock-design" id="cz-mock-design" alt="">' +
          '<div class="cz-mock-text" id="cz-mock-text"></div>' +
        '</div>' +
        '<div class="cz-zoom"><button type="button" id="cz-zoom-out" aria-label="Zoom out">–</button><button type="button" id="cz-zoom-in" aria-label="Zoom in">+</button></div>' +
      "</div>" +
      '<div class="cz-sizerow" id="cz-sizerow" style="display:none"><span>Size</span><input type="range" id="cz-mock-size" min="12" max="92" value="34"><span>Rotate</span><input type="range" id="cz-mock-rot" min="-180" max="180" value="0"></div>' +
      '<div class="cz-textrow"><span>Text</span>' +
        '<select id="cz-text-layout"><option>Horizontal</option><option>Vertical</option><option>Arched Up</option><option>Arched Down</option></select>' +
        '<button type="button" id="cz-bold" class="cz-toggle">Bold</button>' +
        '<input type="range" id="cz-text-size" min="12" max="54" value="22" aria-label="Text size"></div>' +
      '<div class="cz-textrow2">' +
        '<label>Spacing<input type="range" id="cz-text-spacing" min="0" max="26" value="0"></label>' +
        '<label>Curve<input type="range" id="cz-text-curve" min="5" max="55" value="24"></label></div>' +
      '<label class="cz-field"><span>Personalization — name, text, or monogram</span><textarea id="cz-pers" rows="2" placeholder="e.g. “The Zamudio Family” or initials J&amp;L"></textarea></label>' +
      '<div class="cz-two">' + dropdownHTML("Font style", "cz-font", FONTS) + dropdownHTML("Color", "cz-color", COLORS) + "</div>" +
      groupsHTML +
      '<label class="cz-field"><span>Quantity</span><input type="number" id="cz-qty" min="1" step="1" value="1"></label>' +
      uploadHTML +
      dropdownHTML("Digital proof before we make it?", "cz-proof", PROOF) +
      dropdownHTML("When do you need it?", "cz-timeline", TIMELINE) +
      '<label class="cz-field"><span>Comments / special requests (optional)</span><textarea id="cz-comments" rows="2" placeholder="Placement, exact wording, event date, or any notes"></textarea></label>' +
      '<button class="btn btn-gold" id="cz-add" style="width:100%;justify-content:center;margin-top:.4rem">Add to Cart</button>' +
      '<p class="qv-hint">After you order, we email a digital proof to approve before production. Large/bulk order? Message us on Contact for a quote.</p>';
    function selectedTokens() {
      var sel = {};
      body.querySelectorAll(".cz-opt").forEach(function (s) { sel[s.getAttribute("data-label")] = s.value; });
      return sel;
    }
    function refreshPrice() { document.querySelector("#cz-price").textContent = money(unitPrice(p, selectedTokens())); }
    body.querySelectorAll(".cz-opt").forEach(function (s) { s.addEventListener("change", refreshPrice); });
    // live mockup preview
    var persEl = body.querySelector("#cz-pers");
    var fontEl = body.querySelector("#cz-font");
    var colorEl = body.querySelector("#cz-color");
    var mockText = body.querySelector("#cz-mock-text");
    var layoutEl = body.querySelector("#cz-text-layout");
    var textSizeEl = body.querySelector("#cz-text-size");
    var boldBtn = body.querySelector("#cz-bold");
    var spacingEl = body.querySelector("#cz-text-spacing");
    var curveEl = body.querySelector("#cz-text-curve");
    function refreshMock() {
      if (!mockText) return;
      var txt = persEl && persEl.value ? persEl.value.replace(/\s+$/, "") : "";
      var fn = fontEl ? fontEl.value : "";
      var col = colorCSS(colorEl ? colorEl.value : "");
      var fam = fontCSS(fn);
      var bold = boldBtn && boldBtn.classList.contains("on");
      var weight = bold ? "800" : "500";
      var tt = /Monogram/.test(fn) ? "uppercase" : "none";
      var layout = layoutEl ? layoutEl.value : "Horizontal";
      var size = textSizeEl ? Number(textSizeEl.value) : 22;
      var spacing = spacingEl ? Number(spacingEl.value) : 0;
      var bulge = curveEl ? Number(curveEl.value) : 24;
      mockText.style.color = col; mockText.style.fontFamily = fam; mockText.style.fontWeight = weight; mockText.style.textTransform = tt;
      if (/Arched/.test(layout) && txt) {
        var up = /Up/.test(layout);
        var path = up ? ("M14,104 Q100," + (104 - 2 * bulge) + " 186,104") : ("M14,20 Q100," + (20 + 2 * bulge) + " 186,20");
        mockText.style.writingMode = "horizontal-tb"; mockText.style.fontSize = ""; mockText.style.width = "84%"; mockText.style.letterSpacing = "";
        mockText.innerHTML = '<svg viewBox="0 0 200 120" style="width:100%;max-width:none;overflow:visible;pointer-events:none">' +
          '<defs><path id="czarc" d="' + path + '"></path></defs>' +
          '<text font-size="' + size + '" font-family="' + fam.replace(/"/g, "'") + '" font-weight="' + weight + '" letter-spacing="' + spacing + '" fill="' + col + '" style="text-transform:' + tt + '">' +
          '<textPath href="#czarc" startOffset="50%" text-anchor="middle">' + esc(txt) + '</textPath></text></svg>';
      } else if (layout === "Vertical" && txt) {
        mockText.innerHTML = "";
        mockText.textContent = txt.replace(/\n/g, "").split("").join("\n");
        mockText.style.whiteSpace = "pre"; mockText.style.writingMode = "horizontal-tb"; mockText.style.textOrientation = "";
        mockText.style.fontSize = size + "px"; mockText.style.letterSpacing = ""; mockText.style.width = "";
        mockText.style.lineHeight = (0.9 + spacing / 22).toFixed(2); mockText.style.textAlign = "center";
      } else {
        mockText.innerHTML = "";
        mockText.textContent = txt;
        mockText.style.whiteSpace = "pre-line"; mockText.style.writingMode = "horizontal-tb"; mockText.style.textOrientation = "";
        mockText.style.fontSize = size + "px"; mockText.style.letterSpacing = spacing + "px"; mockText.style.width = "";
        mockText.style.lineHeight = "1.05"; mockText.style.textAlign = "center";
      }
    }
    if (persEl) persEl.addEventListener("input", refreshMock);
    if (fontEl) fontEl.addEventListener("change", refreshMock);
    if (colorEl) colorEl.addEventListener("change", refreshMock);
    if (layoutEl) layoutEl.addEventListener("change", refreshMock);
    if (textSizeEl) textSizeEl.addEventListener("input", refreshMock);
    if (spacingEl) spacingEl.addEventListener("input", refreshMock);
    if (curveEl) curveEl.addEventListener("input", refreshMock);
    if (boldBtn) boldBtn.addEventListener("click", function () { boldBtn.classList.toggle("on"); refreshMock(); });
    refreshMock();
    // --- mockup swaps to the selected size/shape variant photo ---
    var baseImg = body.querySelector("#cz-mock-baseimg");
    function selectedFor(label) { var t = null; body.querySelectorAll(".cz-opt").forEach(function (s) { if (s.getAttribute("data-label") === label) t = s.value; }); return t; }
    function variantSrc() {
      var src = null;
      groupsOf(p).forEach(function (g) {
        var token = selectedFor(g.label);
        g.choices.forEach(function (c) { if (snipToken(p, c) === token && c && c.img) src = c.img; });
      });
      return src;
    }
    function refreshBase() { if (baseImg) { var s = variantSrc(); var want = s || p.mockupPhoto; if (baseImg.getAttribute("src") !== want) baseImg.src = want; } }
    body.querySelectorAll(".cz-opt").forEach(function (s) { s.addEventListener("change", refreshBase); });
    refreshBase();
    // --- zoom in / out (+ pan when zoomed) ---
    var zoom = 1, panX = 0, panY = 0, designRot = 0;
    function dtx(el) { return (el && el.id === "cz-mock-design") ? ("translate(-50%,-50%) rotate(" + designRot + "deg)") : "translate(-50%,-50%)"; }
    var mockInner = body.querySelector("#cz-mock-inner");
    var mockBox = body.querySelector("#cz-mockup");
    function applyZoom() { if (mockInner) mockInner.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")"; }
    function clampPan() { var c = mockBox.getBoundingClientRect(); var mx = (zoom - 1) * c.width / 2, my = (zoom - 1) * c.height / 2; panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY)); }
    var zin = body.querySelector("#cz-zoom-in"), zout = body.querySelector("#cz-zoom-out");
    if (zin) zin.addEventListener("click", function () { zoom = Math.min(3, Math.round((zoom + 0.25) * 100) / 100); clampPan(); if (mockBox) mockBox.classList.toggle("zoomed", zoom > 1); applyZoom(); });
    if (zout) zout.addEventListener("click", function () { zoom = Math.max(0.5, Math.round((zoom - 0.25) * 100) / 100); if (zoom <= 1) { panX = 0; panY = 0; } clampPan(); if (mockBox) mockBox.classList.toggle("zoomed", zoom > 1); applyZoom(); });
    // drag to pan when zoomed in
    if (mockInner) mockInner.addEventListener("pointerdown", function (e) {
      if (zoom <= 1) return;
      var sx = e.clientX, sy = e.clientY, x0 = panX, y0 = panY;
      try { mockInner.setPointerCapture(e.pointerId); } catch (_) {}
      function mv(ev) { panX = x0 + (ev.clientX - sx); panY = y0 + (ev.clientY - sy); clampPan(); applyZoom(); }
      function up() { mockInner.removeEventListener("pointermove", mv); mockInner.removeEventListener("pointerup", up); }
      mockInner.addEventListener("pointermove", mv); mockInner.addEventListener("pointerup", up);
      e.preventDefault();
    });
    // --- drag the design & text anywhere on the mockup (works at any zoom) ---
    function makeDraggable(el) {
      if (!el) return;
      el.style.touchAction = "none";
      el.addEventListener("pointerdown", function (e) {
        e.stopPropagation();               // grab the art itself — never pan the background
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add("dragging");
        function move(ev) {
          var cont = mockBox.getBoundingClientRect();
          var f = (ev.clientX - cont.left) / cont.width;
          var g = (ev.clientY - cont.top) / cont.height;
          var L = ((f - 0.5) / zoom + 0.5) * 100 - (panX / (cont.width * zoom)) * 100;
          var T = ((g - 0.5) / zoom + 0.5) * 100 - (panY / (cont.height * zoom)) * 100;
          el.style.left = Math.max(2, Math.min(98, L)) + "%";
          el.style.top = Math.max(2, Math.min(98, T)) + "%";
          el.style.transform = dtx(el);
        }
        function up() { el.classList.remove("dragging"); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); }
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        e.preventDefault();
      });
    }
    makeDraggable(body.querySelector("#cz-mock-design"));
    makeDraggable(body.querySelector("#cz-mock-text"));
    // resize the design with the slider
    var sizeSlider = body.querySelector("#cz-mock-size");
    function applyDesignSize() {
      var md = document.querySelector("#cz-mock-design");
      if (md && sizeSlider) { md.style.maxWidth = "none"; md.style.maxHeight = "none"; md.style.width = sizeSlider.value + "%"; md.style.height = "auto"; md.style.transform = dtx(md); }
    }
    if (sizeSlider) sizeSlider.addEventListener("input", applyDesignSize);
    // rotate the uploaded design with the slider (keeps position + size)
    var rotSlider = body.querySelector("#cz-mock-rot");
    if (rotSlider) rotSlider.addEventListener("input", function () {
      designRot = Number(rotSlider.value);
      var md = document.querySelector("#cz-mock-design");
      if (md) md.style.transform = dtx(md);
    });
    // auto-remove a white/near-white background so the design sits cleanly on the product
    function removeWhiteBg(file, cb) {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, 2200 / img.width), cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
          var c = document.createElement("canvas"); c.width = cw; c.height = ch;
          var ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, cw, ch);
          var id = ctx.getImageData(0, 0, cw, ch), d = id.data;
          // Remove ALL white/near-white (background AND letter counters); soft-fade the near-white edge
          for (var i = 0; i < d.length; i += 4) {
            var mn = Math.min(d[i], d[i + 1], d[i + 2]);
            if (mn >= 242) d[i + 3] = 0;
            else if (mn >= 224) d[i + 3] = Math.min(d[i + 3], Math.round((242 - mn) / 18 * 255));
          }
          ctx.putImageData(id, 0, 0); cb(c.toDataURL("image/png"));
        } catch (e) { cb(URL.createObjectURL(file)); }
      };
      img.onerror = function () { cb(URL.createObjectURL(file)); };
      img.src = URL.createObjectURL(file);
    }
    // place the uploaded design onto the mockup canvas (retries while Uploadcare processes)
    function showMockDesign(url, tries) {
      var md = document.querySelector("#cz-mock-design"); if (!md) return;
      var src = tries < 3 ? (url + "-/preview/2000x2000/-/format/auto/-/quality/best/") : url; // hi-res so it stays crisp when zoomed; fall back to the raw file
      md.onload = function () { md.style.display = "block"; };
      md.onerror = function () { if (tries < 8) setTimeout(function () { showMockDesign(url, tries + 1); }, 700); };
      md.src = src + (tries ? (src.indexOf("?") > -1 ? "&" : "?") + "_r=" + tries : "");
    }
    var up = body.querySelector("#cz-upload");
    var fileInput = body.querySelector("#cz-file");
    if (up && fileInput) {
      up.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        var f = fileInput.files && fileInput.files[0]; if (!f) return;
        var st = document.querySelector("#cz-upstatus");
        if (f.size > 25 * 1024 * 1024) { if (st) st.textContent = "File is over 25MB — please upload a smaller file."; return; }
        // INSTANT local preview on the mockup — white background auto-removed so it sits cleanly on the product
        var md = document.querySelector("#cz-mock-design");
        if (md) {
          if (/^image\//.test(f.type)) {
            removeWhiteBg(f, function (url) {
              md.onload = function () { md.style.display = "block"; applyDesignSize(); };
              md.src = url;
              var sr = document.querySelector("#cz-sizerow"); if (sr) sr.style.display = "flex";
            });
          } else {
            md.style.display = "none";
          }
        }
        if (st) st.textContent = "Uploading " + f.name + "…";
        var fd = new FormData();
        fd.append("UPLOADCARE_PUB_KEY", UC);
        fd.append("UPLOADCARE_STORE", "auto");
        fd.append("file", f);
        fetch("https://upload.uploadcare.com/base/", { method: "POST", body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.file) throw new Error("upload failed");
            state.design = "https://ucarecdn.com/" + d.file + "/";
            if (st) st.textContent = "✓ Attached: " + f.name;
          })
          .catch(function () { if (st) st.textContent = "Preview ready. Note: final file upload failed — please retry or email your design after ordering."; });
      });
    }
    body.querySelector("#cz-add").addEventListener("click", function () {
      var qv = parseInt((body.querySelector("#cz-qty") || {}).value, 10); if (!qv || qv < 1) qv = 1;
      snipAdd(p, {
        personalization: (body.querySelector("#cz-pers") || {}).value || "",
        font: (body.querySelector("#cz-font") || {}).value || "",
        color: (body.querySelector("#cz-color") || {}).value || "",
        options: selectedTokens(),
        design: state.design,
        proof: (body.querySelector("#cz-proof") || {}).value || "",
        timeline: (body.querySelector("#cz-timeline") || {}).value || "",
        comments: (body.querySelector("#cz-comments") || {}).value || "",
        qty: qv
      });
      closeCustomize();
    });
    document.querySelector("#cz-overlay").classList.add("show");
    document.querySelector("#cz-modal").classList.add("show");
  }

  /* ------------------------- cart button + drawer ------------------------ */
  function injectChrome() {
    var navUL = document.querySelector(".nav-links");
    if (navUL && !document.querySelector(".cart-btn")) {
      var li = document.createElement("li");
      li.className = "cart-li";
      if (SNIPCART) li.innerHTML = '<a href="#" class="cart-btn snipcart-checkout" aria-label="Cart">' + cartIcon() + '<span class="cart-count snipcart-items-count">0</span></a>';
      else li.innerHTML = '<a href="#" class="cart-btn" aria-label="Cart">' + cartIcon() + '<span class="cart-count">0</span></a>';
      navUL.appendChild(li);
      if (!SNIPCART) li.querySelector(".cart-btn").addEventListener("click", function (e) { e.preventDefault(); openDrawer(); });
    }
    if (SNIPCART) return;
    if (document.querySelector("#cart-drawer")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="cart-overlay" id="cart-overlay"></div>' +
      '<aside class="cart-drawer" id="cart-drawer" aria-label="Shopping cart">' +
        '<div class="cart-head"><h3>Your Cart</h3><button class="cart-close" aria-label="Close">&times;</button></div>' +
        '<div class="cart-items" id="cart-items"></div>' +
        '<div class="cart-foot" id="cart-foot"></div>' +
      "</aside>";
    document.body.appendChild(wrap);
    document.querySelector("#cart-overlay").addEventListener("click", closeDrawer);
    document.querySelector(".cart-close").addEventListener("click", closeDrawer);
  }
  function cartIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="22" height="22">' +
      '<path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg>';
  }
  function openDrawer() { if (SNIPCART) return; document.querySelector("#cart-drawer").classList.add("open"); document.querySelector("#cart-overlay").classList.add("show"); }
  function closeDrawer() { document.querySelector("#cart-drawer").classList.remove("open"); document.querySelector("#cart-overlay").classList.remove("show"); }

  /* ------------------------------ render ------------------------------ */
  function render() {
    document.querySelectorAll(".cart-count").forEach(function (el) { el.textContent = count(); el.style.display = count() ? "" : "none"; });
    if (SNIPCART) return;
    var box = document.querySelector("#cart-items");
    var foot = document.querySelector("#cart-foot");
    if (!box || !foot) return;
    if (!cart.length) {
      box.innerHTML = '<p class="cart-empty">Your cart is empty.<br><a href="shop.html">Browse the shop &rarr;</a></p>';
      foot.innerHTML = ""; return;
    }
    box.innerHTML = cart.map(function (i) {
      var k = lineKey(i.id, i.option);
      var prod = findProduct(i.id);
      var hasFile = !!FILES[k];
      var optCtrl = "";
      if (prod && choicesOf(prod).length) {
        optCtrl = '<select class="ci-optsel" data-optsel="' + k + '">' +
          choicesOf(prod).map(function (c) {
            var nm = choiceName(c);
            var pr = (typeof c === "object" && c.price != null) ? " — " + money(c.price) : "";
            return '<option value="' + esc(nm) + '"' + (nm === i.option ? " selected" : "") + ">" + esc(nm) + pr + "</option>";
          }).join("") +
          "</select>";
      } else if (i.option) {
        optCtrl = '<span class="ci-opt">' + esc(i.option) + "</span>";
      }
      var design = i.design
        ? '<span class="ci-design' + (hasFile ? " ok" : "") + '">' + (hasFile ? "✓ Design: " : "Design: ") + esc(i.design) + (hasFile ? "" : " (re-attach at checkout)") + "</span>"
        : '<button class="ci-adddesign" data-adddesign="' + k + '">+ Add your design / photo</button>';
      return '<div class="cart-item">' +
        '<img src="' + esc(i.image) + '" alt="' + esc(i.name) + '">' +
        '<div class="ci-info"><strong>' + esc(i.name) + "</strong>" + optCtrl +
        '<span class="ci-price">' + money(i.price) + "</span>" + design +
        '<input type="text" class="ci-note-input" data-note="' + k + '" value="' + esc(i.note) + '" placeholder="Personalization (name, initials, text)">' +
        '<input type="file" accept="image/*,.pdf" class="ci-file" data-cfile="' + k + '" hidden>' +
        "</div>" +
        '<div class="ci-qty"><button data-dec="' + k + '" aria-label="Decrease">&minus;</button><span>' + i.qty + "</span>" +
        '<button data-inc="' + k + '" aria-label="Increase">+</button></div>' +
        '<button class="ci-remove" data-rem="' + k + '" aria-label="Remove">&times;</button>' +
        "</div>";
    }).join("");
    foot.innerHTML =
      '<div class="cart-subtotal"><span>Subtotal</span><strong>' + money(subtotal()) + "</strong></div>" +
      '<p class="cart-note">Add your photo/logo &amp; personalization to any item above. Shipping &amp; custom-work adjustments are confirmed after your order.</p>' +
      '<button class="btn btn-gold" id="cart-checkout" style="width:100%;justify-content:center">' + checkoutLabel() + "</button>" +
      '<div id="pay-area"></div>' +
      '<button class="cart-continue" id="cart-continue">Continue shopping</button>';

    box.querySelectorAll("[data-inc]").forEach(function (b) { b.onclick = function () { var k = b.getAttribute("data-inc"); var l = cart.find(function (i) { return lineKey(i.id, i.option) === k; }); setQty(k, l.qty + 1); }; });
    box.querySelectorAll("[data-dec]").forEach(function (b) { b.onclick = function () { var k = b.getAttribute("data-dec"); var l = cart.find(function (i) { return lineKey(i.id, i.option) === k; }); setQty(k, l.qty - 1); }; });
    box.querySelectorAll("[data-rem]").forEach(function (b) { b.onclick = function () { setQty(b.getAttribute("data-rem"), 0); }; });
    box.querySelectorAll(".ci-note-input").forEach(function (inp) {
      inp.onchange = function () { var k = inp.getAttribute("data-note"); var l = cart.find(function (i) { return lineKey(i.id, i.option) === k; }); if (l) { l.note = inp.value.trim(); save(cart); } };
    });
    box.querySelectorAll(".ci-optsel").forEach(function (sel) {
      sel.onchange = function () {
        var k = sel.getAttribute("data-optsel");
        var l = cart.find(function (i) { return lineKey(i.id, i.option) === k; });
        if (!l) return;
        var oldK = k, newOpt = sel.value;
        if (FILES[oldK]) { FILES[lineKey(l.id, newOpt)] = FILES[oldK]; delete FILES[oldK]; }
        l.option = newOpt;
        l.price = priceFor(findProduct(l.id), newOpt); // update price for the chosen size
        // merge if another identical line now exists
        var dupe = cart.find(function (i) { return i !== l && lineKey(i.id, i.option) === lineKey(l.id, l.option); });
        if (dupe) { dupe.qty += l.qty; cart = cart.filter(function (i) { return i !== l; }); }
        save(cart); render();
      };
    });
    box.querySelectorAll("[data-adddesign]").forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute("data-adddesign"); var inp = box.querySelector('[data-cfile="' + CSS.escape(k) + '"]'); if (inp) inp.click(); };
    });
    box.querySelectorAll(".ci-file").forEach(function (inp) {
      inp.onchange = function () {
        var k = inp.getAttribute("data-cfile");
        var line = cart.find(function (i) { return lineKey(i.id, i.option) === k; });
        if (line && inp.files && inp.files[0]) { line.design = inp.files[0].name; FILES[k] = inp.files[0]; save(cart); render(); }
      };
    });
    document.querySelector("#cart-continue").onclick = closeDrawer;
    document.querySelector("#cart-checkout").onclick = checkout;
  }
  function checkoutLabel() { return MODE === "inquiry" ? "Place Order Request" : "Checkout"; }

  /* ----------------------------- checkout ----------------------------- */
  function checkout() { if (!cart.length) return; if (MODE === "paypal") return payPal(); return inquiry(); }
  function orderText() {
    var lines = cart.map(function (i) {
      var extra = [];
      if (i.note) extra.push('personalization: "' + i.note + '"');
      if (i.design) extra.push("design file: " + i.design);
      return "• " + i.qty + " × " + i.name + (i.option ? " (" + i.option + ")" : "") +
        (extra.length ? " [" + extra.join("; ") + "]" : "") + " — " + money(i.price * i.qty);
    });
    return lines.join("\n") + "\n\nSubtotal: " + money(subtotal());
  }
  function collectFiles() { var out = []; cart.forEach(function (i) { var k = lineKey(i.id, i.option); if (FILES[k]) out.push(FILES[k]); }); return out; }
  function inquiry() {
    var pay = document.querySelector("#pay-area");
    var files = collectFiles();
    if (CO.uploadEndpoint && files.length) {
      var fd = new FormData();
      fd.append("_subject", "New Order + Design — Lacci Studio");
      fd.append("order", orderText());
      files.forEach(function (f, n) { fd.append("design_" + (n + 1), f, f.name); });
      if (pay) pay.innerHTML = '<p class="pay-ok">Uploading your order &amp; design…</p>';
      fetch(CO.uploadEndpoint, { method: "POST", body: fd, headers: { Accept: "application/json" } })
        .then(function (r) {
          if (r.ok) { cart = []; save(cart); FILES = {}; render();
            var items = document.querySelector("#cart-items");
            if (items) items.innerHTML = '<p class="pay-ok" style="text-align:center">Thank you! Your order and design were sent. We’ll confirm details &amp; payment shortly.</p>';
            var f2 = document.querySelector("#cart-foot"); if (f2) f2.innerHTML = "";
          } else mailtoOrder(files);
        }).catch(function () { mailtoOrder(files); });
      return;
    }
    mailtoOrder(files);
  }
  function mailtoOrder(files) {
    var to = CO.orderEmail || "info@laccistudio.com";
    var designNote = (files && files.length)
      ? "\n\nMY DESIGN FILES: " + files.map(function (f) { return f.name; }).join(", ") + "\n(Please attach these file(s) to this email before sending.)"
      : "\n\n(If your item needs a photo/logo, reply to this email with your design attached.)";
    var body = encodeURIComponent("Hi Lacci Studio,\n\nI'd like to order:\n\n" + orderText() + designNote + "\n\nName:\nPhone:\nNotes:\n");
    window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent("New Order Request — Lacci Studio") + "&body=" + body;
    var pay = document.querySelector("#pay-area");
    if (pay) pay.innerHTML = '<p class="pay-ok">Your email is opening with your order' +
      (files && files.length ? '. <strong>Please attach your design file(s)</strong> (' + files.map(function (f) { return esc(f.name); }).join(", ") + ') before sending.' : ' — reply with your design attached if needed.') + '</p>';
  }
  function payPal() {
    var pay = document.querySelector("#pay-area");
    if (!CO.paypalClientId) { if (pay) pay.innerHTML = '<p class="pay-err">PayPal isn\'t connected yet. Add your PayPal Client ID in shop-config.js, or switch checkout mode to "inquiry".</p>'; return; }
    document.querySelector("#cart-checkout").style.display = "none";
    var hasDesign = collectFiles().length || cart.some(function (i) { return i.note; });
    if (pay) pay.innerHTML = (hasDesign ? '<p class="cart-note">After payment, we’ll email you to collect your design/photo &amp; personalization.</p>' : "") + '<div id="paypal-buttons"></div>';
    loadScript("https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(CO.paypalClientId) + "&currency=" + encodeURIComponent(CUR), function () {
      if (!window.paypal) return;
      window.paypal.Buttons({
        style: { color: "gold", shape: "rect", label: "pay" },
        createOrder: function (data, actions) {
          return actions.order.create({ purchase_units: [{
            amount: { value: subtotal().toFixed(2), currency_code: CUR, breakdown: { item_total: { value: subtotal().toFixed(2), currency_code: CUR } } },
            items: cart.map(function (i) { return { name: (i.name + (i.option ? " - " + i.option : "")).slice(0, 127), quantity: String(i.qty), unit_amount: { value: Number(i.price).toFixed(2), currency_code: CUR } }; })
          }] });
        },
        onApprove: function (data, actions) {
          return actions.order.capture().then(function () {
            cart = []; save(cart); FILES = {}; render();
            var p = document.querySelector("#cart-items");
            if (p) p.innerHTML = '<p class="pay-ok" style="text-align:center">Thank you! Payment received. We’ll email you to collect your design &amp; finalize your custom order.</p>';
            var f = document.querySelector("#cart-foot"); if (f) f.innerHTML = "";
          });
        }
      }).render("#paypal-buttons");
    });
  }
  var loaded = {};
  function loadScript(src, cb) { if (loaded[src]) return cb(); var s = document.createElement("script"); s.src = src; s.onload = function () { loaded[src] = 1; cb(); }; document.head.appendChild(s); }

  /* ----------------------------- Snipcart ----------------------------- */
  function initSnipcart() {
    if (!SNIPCART) return;
    var div = document.createElement("div");
    div.id = "snipcart"; div.setAttribute("data-config-modal-style", "side"); div.setAttribute("data-api-key", CO.snipcartApiKey); div.hidden = true;
    document.body.appendChild(div);
    var css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdn.snipcart.com/themes/v3.7.1/default/snipcart.css"; document.head.appendChild(css);
    loadScript("https://cdn.snipcart.com/themes/v3.7.1/default/snipcart.js", function () {});
  }

  /* ------------------------------- init ------------------------------- */
  function init() { renderGrid(); renderFilters(); injectChrome(); injectQuickView(); if (SNIPCART) injectCustomizeModal(); render(); if (SNIPCART) initSnipcart(); }
  init();
  }
  if (window.LACCI_READY) run();
  else document.addEventListener("lacci:ready", run, { once: true });
})();
