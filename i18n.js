(function () {
  var lang = (navigator.language || navigator.userLanguage || "").toLowerCase();
  var useJa = lang.indexOf("ja") === 0;
  var messages = window.__I18N_MESSAGES__;
  var badge = document.querySelector("[data-app-store-badge]");

  if (badge) {
    badge.src = useJa ? badge.dataset.badgeJaSrc : badge.dataset.badgeDefaultSrc;
    badge.alt = useJa ? badge.dataset.badgeJaAlt : badge.dataset.badgeDefaultAlt;
    if (badge.parentElement) {
      badge.parentElement.setAttribute("aria-label", badge.alt);
    }
  }

  if (!useJa || !messages) return;

  document.documentElement.lang = "ja";

  if (messages.title) {
    document.title = messages.title;
  }

  if (messages.metaDescription) {
    var description = document.querySelector('meta[name="description"]');
    var ogDescription = document.querySelector('meta[property="og:description"]');
    var twitterDescription = document.querySelector('meta[name="twitter:description"]');

    if (description) description.setAttribute("content", messages.metaDescription);
    if (ogDescription) ogDescription.setAttribute("content", messages.metaDescription);
    if (twitterDescription) twitterDescription.setAttribute("content", messages.metaDescription);
  }

  Object.keys(messages).forEach(function (key) {
    if (key === "title" || key === "metaDescription") return;

    var node = document.querySelector('[data-i18n="' + key + '"]');
    if (!node) return;

    node.textContent = messages[key];
  });
})();
