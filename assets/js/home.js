/* Homepage: swaps the hero logo card for a real finished-product photo when content/home.json has
   "heroImage". Home has no product grid; the catalog lives in the Shop. */
(function () {
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
})();
