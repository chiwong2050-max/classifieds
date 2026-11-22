/* Classifieds - progressive enhancement (vanilla JS, no dependencies). */
(function () {
  'use strict';

  function slugify(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* --- Image gallery ------------------------------------------------------ */
  function initGallery() {
    var main = document.getElementById('gallery-main');
    var thumbs = document.getElementById('gallery-thumbs');
    if (!main || !thumbs) return;
    thumbs.addEventListener('click', function (e) {
      var img = e.target.closest('img[data-full]');
      if (!img) return;
      main.src = img.dataset.full;
      thumbs.querySelectorAll('img').forEach(function (t) { t.removeAttribute('aria-current'); });
      img.setAttribute('aria-current', 'true');
    });
  }

  /* --- Share buttons ------------------------------------------------------ */
  function initShare() {
    document.querySelectorAll('[data-share]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var url = btn.dataset.url || window.location.href;
        var title = btn.dataset.title || document.title;
        if (navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            var original = btn.textContent;
            btn.textContent = 'Link copied';
            setTimeout(function () { btn.textContent = original; }, 1800);
          });
        } else {
          window.prompt('Copy this link', url);
        }
      });
    });
  }

  /* --- Post form: image count -------------------------------------------- */
  function initImageCount() {
    var input = document.querySelector('[data-images-input]');
    var out = document.querySelector('[data-images-count]');
    if (!input || !out) return;
    input.addEventListener('change', function () {
      var n = input.files ? input.files.length : 0;
      out.textContent = n ? n + ' photo' + (n === 1 ? '' : 's') + ' selected' : '';
    });
  }

  /* --- Post form: category-specific attribute groups ---------------------- */
  function initAttrGroups() {
    var select = document.querySelector('[data-category-select]');
    var wrap = document.querySelector('[data-attr-groups]');
    if (!select || !wrap) return;

    function apply() {
      var cat = select.value;
      wrap.querySelectorAll('[data-attr-group]').forEach(function (group) {
        var key = group.dataset.attrGroup;
        var show = cat === key || (key === 'default' && cat && !['vehicles', 'jobs', 'property-rentals', 'events'].includes(cat));
        group.hidden = !show;
        // Disable hidden inputs so they are not submitted.
        group.querySelectorAll('input, select, textarea').forEach(function (el) {
          el.disabled = !show;
        });
      });
    }
    select.addEventListener('change', apply);
    apply();
  }

  /* --- Post form: country > state > city cascade -------------------------- */
  function initLocationCascade() {
    var countrySel = document.querySelector('[data-country]');
    var stateSel = document.querySelector('[data-state]');
    var citySel = document.querySelector('[data-city]');
    if (!countrySel || !stateSel || !citySel) return;

    var desired = {
      country: countrySel.value,
      state: stateSel.dataset.value || stateSel.value,
      city: citySel.dataset.value || citySel.value,
    };

    fetch('/api/locations', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        function fillStates() {
          var country = data[countrySel.value];
          stateSel.innerHTML = '<option value="">Choose…</option>';
          if (!country) return;
          Object.keys(country.states).forEach(function (slug) {
            var opt = document.createElement('option');
            opt.value = slug;
            opt.textContent = country.states[slug].name;
            stateSel.appendChild(opt);
          });
          if (desired.state) stateSel.value = desired.state;
        }
        function fillCities() {
          var country = data[countrySel.value];
          var state = country && country.states[stateSel.value];
          citySel.innerHTML = '<option value="">Choose…</option>';
          if (!state) return;
          state.cities.forEach(function (name) {
            var opt = document.createElement('option');
            opt.value = slugify(name);
            opt.textContent = name;
            citySel.appendChild(opt);
          });
          if (desired.city) citySel.value = desired.city;
        }

        fillStates();
        fillCities();

        countrySel.addEventListener('change', function () {
          desired.state = '';
          desired.city = '';
          fillStates();
          fillCities();
        });
        stateSel.addEventListener('change', function () {
          desired.city = '';
          fillCities();
        });
      })
      .catch(function () { /* no-JS fallback: selects keep server-rendered options */ });
  }

  /* --- Service worker (app shell only) ------------------------------------ */
  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initGallery();
    initShare();
    initImageCount();
    initAttrGroups();
    initLocationCascade();
    initServiceWorker();
  });
})();
