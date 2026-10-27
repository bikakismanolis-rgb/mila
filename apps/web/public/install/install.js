// Η λογική της σελίδας /install: γλώσσα, καρτέλα ανά συσκευή, κουμπί
// εγκατάστασης. Σε δικό της αρχείο και όχι μέσα στη σελίδα, ώστε το
// Content-Security-Policy (vercel.json) να μην επιτρέπει inline scripts.

(function () {
  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  // Ενσωματωμένοι browsers άλλων εφαρμογών: από εκεί δεν γίνεται εγκατάσταση.
  var inApp = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Viber|Line\/|MicroMessenger|; wv\)/.test(ua);
  var installed =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true;

  function show(selector, on) {
    document.querySelectorAll(selector).forEach(function (el) { el.hidden = !on; });
  }

  // Γλώσσα: ό,τι έχει διαλέξει μέσα στο app, αλλιώς του browser.
  function setLang(lang) {
    document.documentElement.lang = lang;
    document.title = lang === "el" ? "Εγκατάσταση · Mila" : "Install · Mila";
    document.querySelectorAll("[data-lang]").forEach(function (el) {
      el.hidden = el.getAttribute("data-lang") !== lang;
    });
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-set-lang") === lang));
    });
  }
  var saved = null;
  try { saved = localStorage.getItem("mila:lang"); } catch (e) {}
  var browserLang = (navigator.language || "").toLowerCase().indexOf("el") === 0 ? "el" : "en";
  setLang(saved === "el" || saved === "en" ? saved : browserLang);
  document.querySelectorAll("[data-set-lang]").forEach(function (b) {
    b.addEventListener("click", function () {
      var lang = b.getAttribute("data-set-lang");
      try { localStorage.setItem("mila:lang", lang); } catch (e) {}
      setLang(lang);
    });
  });

  // Καρτέλες ανά συσκευή, με προεπιλογή αυτή που κρατάει ο χρήστης.
  function setTab(tab) {
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab));
    });
    document.querySelectorAll("[data-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-panel") !== tab;
    });
  }
  setTab(isIOS ? "ios" : isAndroid ? "android" : "desktop");
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
  });

  show('[data-show="installed"]', installed);
  show('[data-show="inapp"]', inApp && !installed);

  // Chrome / Edge: εγκατάσταση με ένα πάτημα, όταν ο browser το επιτρέπει.
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferred = event;
    if (!installed) show("[data-install]", true);
  });
  document.querySelectorAll("[data-install]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () {
        deferred = null;
        show("[data-install]", false);
      });
    });
  });
  window.addEventListener("appinstalled", function () {
    show("[data-install]", false);
    show('[data-show="installed"]', true);
  });

  // Ίδιος service worker με το app: κάνει τη σελίδα εγκαταστάσιμη και στους
  // παλιότερους Chrome, που τον ζητούσαν.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }
})();
