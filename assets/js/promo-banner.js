/* =========================================================================
   LACCI STUDIO — SALE BANNER
   -------------------------------------------------------------------------
   Nothing to edit here. Everything is controlled from
   laccistudio.com/admin  →  Contact & Settings  →  Sale Banner.
   ========================================================================= */
(function () {
  var KEY = "lacci_promo_dismissed_v1";

  function build() {
    var P = window.LACCI_PROMO;
    if (!P || !P.on) return;
    if (!P.message && !P.image && !P.subtext) return;

    // --- seasonal window ---
    var now = new Date();
    if (P.start) { if (now < new Date(P.start + "T00:00:00")) return; }
    if (P.end)   { if (now > new Date(P.end   + "T23:59:59")) return; }

    // --- respect a dismissal of THIS exact promo ---
    var stamp = (P.message || "") + "|" + (P.code || "") + "|" + (P.image || "");
    if (P.dismissible) {
      try { if (localStorage.getItem(KEY) === stamp) return; } catch (e) {}
    }

    var bar = document.createElement("div");
    bar.className = "promo-bar promo-" + (P.theme || "gold") + " promo-size-" + (P.size || "strip");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Promotion");

    var inner = document.createElement("div");
    inner.className = "promo-inner";

    // --- your design as a full-width background ---
    if (P.image) {
      bar.classList.add("promo-has-bg");
      bar.classList.add("promo-img-" + (P.imageStyle || "tint"));
      var bg = document.createElement("div");
      bg.className = "promo-bg";
      bg.style.backgroundImage = 'url("' + P.image + '")';
      bg.setAttribute("aria-hidden", "true");
      bar.appendChild(bg);
    }

    if (P.eyebrow) {
      var eb = document.createElement("span");
      eb.className = "promo-eyebrow";
      eb.textContent = P.eyebrow;
      inner.appendChild(eb);
    }

    if (P.message) {
      var msg = document.createElement(P.size === "large" ? "h2" : "span");
      msg.className = "promo-msg";
      msg.textContent = P.message;
      inner.appendChild(msg);
    }

    if (P.subtext) {
      var sub = document.createElement("p");
      sub.className = "promo-sub";
      sub.textContent = P.subtext;
      inner.appendChild(sub);
    }

    // --- click-to-copy promo code ---
    if (P.code) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "promo-code";
      btn.setAttribute("aria-label", "Copy promo code " + P.code);
      btn.innerHTML = '<span class="promo-code-text"></span>';
      btn.querySelector(".promo-code-text").textContent = P.code;
      btn.onclick = function () {
        var label = btn.querySelector(".promo-code-text");
        var done = function () {
          btn.classList.add("copied");
          label.textContent = "Copied!";
          setTimeout(function () {
            btn.classList.remove("copied");
            label.textContent = P.code;
          }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(P.code).then(done, done);
        } else {
          var t = document.createElement("textarea");
          t.value = P.code;
          document.body.appendChild(t);
          t.select();
          try { document.execCommand("copy"); } catch (e) {}
          document.body.removeChild(t);
          done();
        }
      };
      inner.appendChild(btn);
    }

    if (P.linkText && P.linkUrl) {
      var a = document.createElement("a");
      a.className = "promo-link";
      a.href = P.linkUrl;
      a.textContent = P.linkText;
      inner.appendChild(a);
    }

    bar.appendChild(inner);

    if (P.dismissible) {
      var x = document.createElement("button");
      x.type = "button";
      x.className = "promo-close";
      x.setAttribute("aria-label", "Dismiss promotion");
      x.innerHTML = "&times;";
      x.onclick = function () {
        bar.style.height = bar.offsetHeight + "px";
        requestAnimationFrame(function () { bar.classList.add("promo-hiding"); });
        setTimeout(function () { bar.remove(); }, 320);
        try { localStorage.setItem(KEY, stamp); } catch (e) {}
      };
      bar.appendChild(x);
    }

    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (window.LACCI_READY) build();
  else document.addEventListener("lacci:ready", build, { once: true });
})();
