/* =========================================================================
   Lacci Studio — content loader
   Fetches editable content from /content/*.json (managed by the /admin editor)
   and exposes it as window.LACCI_CONFIG + window.LACCI_SHOP, then fires
   'lacci:ready' so cart.js and main.js can initialize.
   ========================================================================= */
(function () {
  function getJSON(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Swipeable slideshow (photos + video) for gallery items — mirrors the product carousel
  function setupGalleryCarousels(grid) {
    grid.querySelectorAll(".gal-media").forEach(function (media) {
      var slides = media.querySelectorAll(".pslide");
      if (slides.length < 2) return;
      var dots = media.querySelectorAll(".pdot");
      function show(n) {
        var cur = parseInt(media.getAttribute("data-idx") || "0", 10);
        var pv = slides[cur].querySelector("video"); if (pv) pv.pause();
        n = (n + slides.length) % slides.length;
        slides.forEach(function (s, i) { s.classList.toggle("active", i === n); });
        dots.forEach(function (d, i) { d.classList.toggle("on", i === n); });
        media.setAttribute("data-idx", n);
        var v = slides[n].querySelector("video"); if (v) v.play().catch(function () {});
      }
      var prev = media.querySelector(".pnav.prev"), next = media.querySelector(".pnav.next");
      if (prev) prev.addEventListener("click", function (e) { e.preventDefault(); show(parseInt(media.getAttribute("data-idx") || "0", 10) - 1); });
      if (next) next.addEventListener("click", function (e) { e.preventDefault(); show(parseInt(media.getAttribute("data-idx") || "0", 10) + 1); });
      dots.forEach(function (d) { d.addEventListener("click", function () { show(parseInt(d.getAttribute("data-d"), 10)); }); });
      var x0 = null;
      media.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      media.addEventListener("touchend", function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(parseInt(media.getAttribute("data-idx") || "0", 10) + (dx < 0 ? 1 : -1)); x0 = null; });
    });
  }

  Promise.all([
    getJSON("/content/settings.json"),
    getJSON("/content/products.json"),
    getJSON("/content/home.json"),
    getJSON("/content/gallery.json")
  ]).then(function (res) {
    var s = res[0] || {};
    var p = res[1] || {};
    var h = res[2] || {};
    var g = res[3] || {};

    // ---- Contact / site settings (used by main.js) ----
    window.LACCI_CONFIG = {
      email: s.email || "",
      phone: s.phone || "",
      hoursWeekday: s.hoursWeekday || "",
      hoursSaturday: s.hoursSaturday || "",
      hoursSunday: s.hoursSunday || "",
      instagram: s.instagram || "",
      facebook: s.facebook || "",
      etsy: s.etsy || ""
    };

    // ---- Shop (used by cart.js) ----
    function mapChoice(c) {
      if (typeof c === "string") return { name: c };
      var o = { name: c.name };
      if (c.price !== undefined && c.price !== null && c.price !== "") o.price = Number(c.price);
      if (c.add !== undefined && c.add !== null && c.add !== "") o.add = Number(c.add);
      if (c.img) o.img = c.img;
      return o;
    }
    function mapGroup(g) { return { label: g.label || "Option", choices: (g.choices || []).map(mapChoice) }; }
    var products = (p.products || []).filter(function (pr) { return !pr.hidden; }).map(function (pr) {
      var groups = [];
      if (pr.optionGroups && pr.optionGroups.length) {
        groups = pr.optionGroups.map(mapGroup);
      } else if (pr.choices && pr.choices.length) {
        groups = [{ label: pr.optionLabel || "Option", choices: pr.choices.map(mapChoice) }];
      }
      var imgs = (pr.images && pr.images.length) ? pr.images : (pr.image ? [pr.image] : []);
      return {
        id: pr.id, name: pr.name, price: Number(pr.price),
        image: imgs[0] || "", images: imgs, video: pr.video || "",
        category: pr.category, description: pr.description,
        mockupPhoto: pr.mockupPhoto || "",
        options: groups[0] || null, optionGroups: groups
      };
    });
    window.LACCI_SHOP = {
      currency: "USD",
      currencySymbol: "$",
      checkout: {
        mode: s.checkoutMode || "inquiry",
        orderEmail: s.orderEmail || s.email || "",
        paypalClientId: s.paypalClientId || "",
        snipcartApiKey: s.snipcartApiKey || "",
        uploadEndpoint: s.uploadEndpoint || "",
        uploadcarePublicKey: s.uploadcarePublicKey || ""
      },
      products: products
    };

    // ---- Inject editable homepage text ----
    Object.keys(h).forEach(function (k) {
      document.querySelectorAll('[data-c="' + k + '"]').forEach(function (el) {
        el.textContent = h[k];
      });
    });

    // ---- Gallery page ----
    var ggrid = document.querySelector("#gallery-grid");
    if (ggrid) {
      if (g.intro) document.querySelectorAll('[data-c="galleryIntro"]').forEach(function (el) { el.textContent = g.intro; });
      ggrid.innerHTML = (g.items || []).map(function (it) {
        var imgs = (it.images && it.images.length) ? it.images : (it.image ? [it.image] : []);
        var slides = imgs.map(function (src, i) {
          return '<div class="pslide' + (i === 0 ? " active" : "") + '"><img src="' + esc(src) + '" alt="' + esc(it.caption || "") + '" loading="lazy"></div>';
        });
        if (it.video) slides.push('<div class="pslide"><video src="' + esc(it.video) + '" muted loop playsinline preload="metadata"></video><span class="pvid-badge">▶ Video</span></div>');
        if (!slides.length) slides = ['<div class="pslide active"></div>'];
        var nav = "";
        if (slides.length > 1) {
          var dots = "";
          for (var i = 0; i < slides.length; i++) dots += '<span class="pdot' + (i === 0 ? " on" : "") + '" data-d="' + i + '"></span>';
          nav = '<button class="pnav prev" aria-label="Previous photo">‹</button><button class="pnav next" aria-label="Next photo">›</button><div class="pdots">' + dots + "</div>";
        }
        return '<figure class="gal-item" data-category="' + esc(it.category || "") + '">' +
          '<div class="prod-media gal-media" data-idx="0" style="position:absolute;inset:0;aspect-ratio:auto;height:100%">' + slides.join("") + nav + "</div>" +
          (it.caption ? '<figcaption>' + esc(it.caption) + "</figcaption>" : "") + "</figure>";
      }).join("");
      setupGalleryCarousels(ggrid);
      // category filters (same set as the shop)
      var gfilt = document.querySelector("#gallery-filters");
      if (gfilt) {
        var order = ["Drinkware", "Apparel", "Gifts", "Home", "Stickers"];
        var present = order.filter(function (c) { return (g.items || []).some(function (it) { return it.category === c; }); });
        gfilt.innerHTML = ['<button class="filter-btn active" data-filter="all">All</button>']
          .concat(present.map(function (c) { return '<button class="filter-btn" data-filter="' + esc(c) + '">' + esc(c) + "</button>"; })).join("");
        gfilt.querySelectorAll(".filter-btn").forEach(function (b) {
          b.addEventListener("click", function () {
            gfilt.querySelectorAll(".filter-btn").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            var f = b.getAttribute("data-filter");
            ggrid.querySelectorAll(".gal-item").forEach(function (fig) {
              fig.style.display = (f === "all" || fig.getAttribute("data-category") === f) ? "" : "none";
            });
          });
        });
      }
    }

    window.LACCI_READY = true;
    document.dispatchEvent(new Event("lacci:ready"));
  });
})();
