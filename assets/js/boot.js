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

  // Full-screen lightbox for gallery items (click a tile to view photos large)
  var LB = { media: [], idx: 0, cap: "" };
  function buildLightbox() {
    var lb = document.querySelector("#gal-lb");
    if (lb) return lb;
    lb = document.createElement("div");
    lb.id = "gal-lb";
    lb.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(20,14,10,.94);display:none;align-items:center;justify-content:center;flex-direction:column";
    lb.innerHTML =
      '<button id="lb-close" aria-label="Close" style="position:absolute;top:16px;right:22px;font-size:2.2rem;color:#fff;background:none;border:none;cursor:pointer;line-height:1">&times;</button>' +
      '<button id="lb-prev" aria-label="Previous" style="position:absolute;left:2%;top:50%;transform:translateY(-50%);font-size:2rem;color:#fff;background:rgba(0,0,0,.35);border:none;border-radius:50%;width:52px;height:52px;cursor:pointer">&#8249;</button>' +
      '<div id="lb-stage" style="max-width:92vw;max-height:82vh;display:flex;align-items:center;justify-content:center"></div>' +
      '<button id="lb-next" aria-label="Next" style="position:absolute;right:2%;top:50%;transform:translateY(-50%);font-size:2rem;color:#fff;background:rgba(0,0,0,.35);border:none;border-radius:50%;width:52px;height:52px;cursor:pointer">&#8250;</button>' +
      '<div id="lb-cap" style="color:#fff;margin-top:14px;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase"></div>' +
      '<div id="lb-count" style="color:rgba(255,255,255,.65);margin-top:4px;font-size:.72rem"></div>';
    document.body.appendChild(lb);
    lb.querySelector("#lb-close").addEventListener("click", lbClose);
    lb.querySelector("#lb-prev").addEventListener("click", function (e) { e.stopPropagation(); lbNav(-1); });
    lb.querySelector("#lb-next").addEventListener("click", function (e) { e.stopPropagation(); lbNav(1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) lbClose(); });
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("#gal-lb").style.display === "none") return;
      if (e.key === "Escape") lbClose(); else if (e.key === "ArrowLeft") lbNav(-1); else if (e.key === "ArrowRight") lbNav(1);
    });
    return lb;
  }
  function lbShow() {
    var lb = document.querySelector("#gal-lb"), m = LB.media[LB.idx];
    lb.querySelector("#lb-stage").innerHTML = (m && m.type === "video")
      ? '<video src="' + esc(m.src) + '" controls autoplay playsinline style="max-width:92vw;max-height:82vh;border-radius:6px"></video>'
      : '<img src="' + esc(m ? m.src : "") + '" alt="" style="max-width:92vw;max-height:82vh;object-fit:contain;border-radius:6px">';
    lb.querySelector("#lb-cap").textContent = LB.cap || "";
    lb.querySelector("#lb-count").textContent = LB.media.length > 1 ? (LB.idx + 1) + " / " + LB.media.length : "";
    lb.querySelector("#lb-prev").style.display = LB.media.length > 1 ? "" : "none";
    lb.querySelector("#lb-next").style.display = LB.media.length > 1 ? "" : "none";
  }
  function lbOpen(media, cap, idx) { if (!media.length) return; LB.media = media; LB.cap = cap; LB.idx = idx || 0; buildLightbox().style.display = "flex"; lbShow(); }
  function lbNav(d) { if (!LB.media.length) return; LB.idx = (LB.idx + d + LB.media.length) % LB.media.length; lbShow(); }
  function lbClose() { var lb = document.querySelector("#gal-lb"); if (lb) { lb.style.display = "none"; lb.querySelectorAll("video").forEach(function (v) { v.pause(); }); } }

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
      instagram: s.instagram || "",
      facebook: s.facebook || "",
      etsy: s.etsy || "",
      tiktok: s.tiktok || "",
      pinterest: s.pinterest || "",
      youtube: s.youtube || ""
    };

    // ---- Sale banner (used by promo-banner.js) ----
    window.LACCI_PROMO = {
      on:        s.saleBannerOn === true,
      message:   s.saleBanner || "",
      code:      s.saleBannerCode || "",
      linkText:  s.saleBannerLinkText || "",
      linkUrl:   s.saleBannerLink || "",
      image:     s.saleBannerImage || "",
      start:     s.saleBannerStart || "",
      end:       s.saleBannerEnd || "",
      theme:     s.saleBannerTheme || "gold",
      size:      s.saleBannerSize || "strip",
      eyebrow:   s.saleBannerEyebrow || "",
      subtext:   s.saleBannerSubtext || "",
      dismissible: s.saleBannerDismissible !== false
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
        return '<figure class="gal-item" data-category="' + esc(it.category || "") + '" data-subcategory="' + esc(it.subcategory || "") + '">' +
          '<div class="prod-media gal-media" data-idx="0" style="position:absolute;inset:0;aspect-ratio:auto;height:100%">' + slides.join("") + nav + "</div>" +
          (it.caption ? '<figcaption>' + esc(it.caption) + "</figcaption>" : "") + "</figure>";
      }).join("");
      setupGalleryCarousels(ggrid);
      // click a tile to open the full-size lightbox (inline arrows/dots still work)
      var gfigs = ggrid.querySelectorAll(".gal-item");
      (g.items || []).forEach(function (it, fi) {
        var fig = gfigs[fi]; if (!fig) return;
        var imgs = (it.images && it.images.length) ? it.images : (it.image ? [it.image] : []);
        var media = imgs.map(function (s) { return { type: "img", src: s }; });
        if (it.video) media.push({ type: "video", src: it.video });
        if (!media.length) return;
        fig.style.cursor = "zoom-in";
        fig.addEventListener("click", function (e) {
          if (e.target.closest(".pnav") || e.target.closest(".pdot")) return;
          var gm = fig.querySelector(".gal-media");
          lbOpen(media, it.caption || "", gm ? parseInt(gm.getAttribute("data-idx") || "0", 10) : 0);
        });
      });
      // category + subcategory filters, built automatically from your gallery data
      var gfilt = document.querySelector("#gallery-filters");
      if (gfilt) {
        var items = g.items || [];
        var gsub = document.querySelector("#gallery-subfilters");
        if (!gsub) {
          gsub = document.createElement("div");
          gsub.id = "gallery-subfilters"; gsub.className = "shop-filters shop-subfilters"; gsub.style.display = "none";
          gfilt.parentNode.insertBefore(gsub, gfilt.nextSibling);
        }
        var cats = [];
        items.forEach(function (it) { if (it.category && cats.indexOf(it.category) < 0) cats.push(it.category); });
        gfilt.innerHTML = ['<button class="filter-btn active" data-filter="all">All</button>']
          .concat(cats.map(function (c) { return '<button class="filter-btn" data-filter="' + esc(c) + '">' + esc(c) + "</button>"; })).join("");
        function gapply(cat, subcat) {
          ggrid.querySelectorAll(".gal-item").forEach(function (fig) {
            var okc = (cat === "all") || fig.getAttribute("data-category") === cat;
            var oks = (!subcat || subcat === "all") || fig.getAttribute("data-subcategory") === subcat;
            fig.style.display = (okc && oks) ? "" : "none";
          });
        }
        function gshowSubs(cat) {
          if (cat === "all") { gsub.style.display = "none"; gsub.innerHTML = ""; return; }
          var subs = [];
          items.forEach(function (it) { if (it.category === cat && it.subcategory && subs.indexOf(it.subcategory) < 0) subs.push(it.subcategory); });
          if (!subs.length) { gsub.style.display = "none"; gsub.innerHTML = ""; return; }
          gsub.innerHTML = ['<button class="filter-btn active" data-sub="all">All ' + esc(cat) + "</button>"]
            .concat(subs.map(function (s) { return '<button class="filter-btn" data-sub="' + esc(s) + '">' + esc(s) + "</button>"; })).join("");
          gsub.style.display = "flex";
          gsub.querySelectorAll(".filter-btn").forEach(function (sb) {
            sb.addEventListener("click", function () {
              gsub.querySelectorAll(".filter-btn").forEach(function (x) { x.classList.remove("active"); });
              sb.classList.add("active");
              gapply(cat, sb.getAttribute("data-sub"));
            });
          });
        }
        gfilt.querySelectorAll(".filter-btn").forEach(function (b) {
          b.addEventListener("click", function () {
            gfilt.querySelectorAll(".filter-btn").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            var f = b.getAttribute("data-filter");
            gapply(f, "all"); gshowSubs(f);
          });
        });
      }
    }

    window.LACCI_READY = true;
    document.dispatchEvent(new Event("lacci:ready"));
  });
})();
