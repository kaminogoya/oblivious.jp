(function () {
  var STORAGE_KEY = "oblivious-lang";
  var translations = window.__I18N_MESSAGES__ || {};
  var supported = ["en"].concat(Object.keys(translations));

  var emailLinks = document.querySelectorAll(".email-link[data-email-user][data-email-domain]");
  emailLinks.forEach(function (link) {
    var address = link.dataset.emailUser + "@" + link.dataset.emailDomain;
    link.href = "mailto:" + address;
    link.textContent = address;
    link.setAttribute("aria-label", address);
  });

  var badge = document.querySelector("[data-app-store-badge]");
  var selects = document.querySelectorAll("[data-lang-select]");
  var nodes = document.querySelectorAll("[data-i18n]");
  // 本文に強調を含むノード。textContent では markup を運べないので innerHTML で差し替える。
  // 値は自前の生成物（scripts/build-pages.mjs）か手書きのページ内マップで、外から来ることはない。
  var htmlNodes = document.querySelectorAll("[data-i18n-html]");

  var defaultTitle = document.title;
  var descriptionMeta = document.querySelector('meta[name="description"]');
  var defaultDescription = descriptionMeta ? descriptionMeta.getAttribute("content") : "";
  var defaults = {};
  nodes.forEach(function (node) {
    defaults[node.dataset.i18n] = node.textContent;
  });
  var htmlDefaults = {};
  htmlNodes.forEach(function (node) {
    htmlDefaults[node.dataset.i18nHtml] = node.innerHTML;
  });

  function storedLang() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return supported.indexOf(value) !== -1 ? value : null;
    } catch (e) {
      return null;
    }
  }

  // ブラウザの言語タグを対応言語のキーへ解決する。中国語だけは一次言語では繁体・簡体を
  // 区別できないため、script（無ければ地域）まで見て zh-Hant / zh-Hans のどちらかへ倒す
  // （アプリ側 HelpContentParser.languagePreference と同じ規則・oblivious #981）。
  function resolveCandidate(tag) {
    var code = (tag || "").toLowerCase();
    if (!code) return null;
    var parts = code.split("-");
    if (parts[0] === "zh") {
      var script = "hans";
      for (var i = 1; i < parts.length; i++) {
        var part = parts[i];
        if (part === "hant" || part === "tw" || part === "hk" || part === "mo") { script = "hant"; break; }
        if (part === "hans" || part === "cn" || part === "sg" || part === "my") { script = "hans"; break; }
      }
      code = "zh-" + script;
    } else {
      code = parts[0];
    }
    for (var j = 0; j < supported.length; j++) {
      if (supported[j].toLowerCase() === code) return supported[j];
    }
    return null;
  }

  function detectLang() {
    var candidates = navigator.languages || [navigator.language || navigator.userLanguage || ""];
    for (var i = 0; i < candidates.length; i++) {
      var lang = resolveCandidate(candidates[i]);
      if (lang) return lang;
    }
    return "en";
  }

  function apply(lang) {
    var messages = translations[lang] || {};

    document.documentElement.lang = lang;
    document.title = messages.title || defaultTitle;

    var description = messages.metaDescription || defaultDescription;
    if (description) {
      [
        document.querySelector('meta[name="description"]'),
        document.querySelector('meta[property="og:description"]'),
        document.querySelector('meta[name="twitter:description"]')
      ].forEach(function (meta) {
        if (meta) meta.setAttribute("content", description);
      });
    }

    nodes.forEach(function (node) {
      var text = messages[node.dataset.i18n];
      node.textContent = text != null ? text : defaults[node.dataset.i18n];
    });

    htmlNodes.forEach(function (node) {
      var html = messages[node.dataset.i18nHtml];
      node.innerHTML = html != null ? html : htmlDefaults[node.dataset.i18nHtml];
    });

    if (badge) {
      badge.src = badge.getAttribute("data-badge-" + lang + "-src") || badge.dataset.badgeDefaultSrc;
      badge.alt = badge.getAttribute("data-badge-" + lang + "-alt") || badge.dataset.badgeDefaultAlt;
      if (badge.parentElement) {
        badge.parentElement.setAttribute("aria-label", badge.alt);
      }
    }

    selects.forEach(function (select) {
      select.value = lang;
    });
  }

  selects.forEach(function (select) {
    select.addEventListener("change", function () {
      try {
        localStorage.setItem(STORAGE_KEY, select.value);
      } catch (e) {}
      apply(select.value);
    });
  });

  apply(storedLang() || detectLang());
})();
