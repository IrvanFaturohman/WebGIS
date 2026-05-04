/* =============================================
   DUBAI GIS EXPLORER — MAIN APPLICATION
   Leaflet + Turf.js spatial filtering
   ============================================= */
(function () {
  'use strict';

  // ────────────────────────────────────────────
  //  CATEGORY COLOR MAP (recognized categories)
  //  Unrecognized categories → SKIP (not rendered)
  // ────────────────────────────────────────────
  const CATEGORY_MAP = {
    // Makanan & Minuman
    'restaurant':        { color: '#FF6B6B', label: 'Restoran',           group: 'Makanan & Minuman' },
    // Kesehatan
    'hospital':          { color: '#FF4757', label: 'Rumah Sakit',        group: 'Kesehatan' },
    'clinic':            { color: '#FF6B81', label: 'Klinik',             group: 'Kesehatan' },
    // Ibadah
    'place_of_worship':  { color: '#ECCC68', label: 'Ibadah',             group: 'Ibadah' },
    // Pendidikan
    'college':           { color: '#5352ED', label: 'Universitas',        group: 'Pendidikan' },
    // Transportasi & Utilitas
    'fuel':              { color: '#FFA502', label: 'SPBU',               group: 'Transportasi' },
    'bank':              { color: '#2F3542', label: 'Bank',               group: 'Transportasi' },
    'atm':               { color: '#57606F', label: 'ATM',                group: 'Transportasi' },
    'police':            { color: '#3498DB', label: 'Polisi',             group: 'Transportasi' },
    'ferry_terminal':    { color: '#0652DD', label: 'Pelabuhan',          group: 'Transportasi' },
    'cruise_terminal':   { color: '#0652DD', label: 'Pelabuhan',          group: 'Transportasi' },
    'bus_station':       { color: '#009432', label: 'Halte Bus',          group: 'Transportasi' },
    // Fasilitas Publik
    'toilets':           { color: '#BDC581', label: 'Toilet',             group: 'Fasilitas Publik' },
    'parking':           { color: '#747D8C', label: 'Parkir',             group: 'Transportasi' },
    // Embassy & Government
    'embassy':           { color: '#8E44AD', label: 'Gedung Embassy',     group: 'Fasilitas Publik' },
    'office_government': { color: '#F1C40F', label: 'Office Government',  group: 'Fasilitas Publik' },
  };

  // ────────────────────────────────────────────
  //  STATE
  // ────────────────────────────────────────────
  const state = {
    allRendered: [],           // All rendered features (after filtering)
    filteredForDisplay: [],    // After search filter
    markerLayers: {},          // kategori → L.layerGroup
    categoryStats: {},         // kategori → count
    activeCategories: new Set(),
    searchQuery: '',
  };

  // ────────────────────────────────────────────
  //  HELPERS
  // ────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg, type = 'info', dur = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 350); }, dur);
  }

  function setLoadingStatus(msg, pct) {
    $('#loading-status').textContent = msg;
    if (pct !== undefined) $('#loading-bar').style.width = pct + '%';
  }

  function hideLoading() {
    $('#loading-bar').style.width = '100%';
    setTimeout(() => $('#loading-overlay').classList.add('fade-out'), 400);
  }

  // Check if a name is valid (not null/undefined/empty/whitespace-only)
  function hasValidName(props) {
    const n = props.nama || props.name;
    return n && typeof n === 'string' && n.trim().length > 0;
  }

  // Check if a category is recognized
  function isRecognized(kategori) {
    return kategori && CATEGORY_MAP.hasOwnProperty(kategori);
  }

  // Get color for a category
  function getCatColor(kategori) {
    return CATEGORY_MAP[kategori]?.color || '#555';
  }

  // Get label for a category
  function getCatLabel(kategori) {
    return CATEGORY_MAP[kategori]?.label || kategori;
  }

  // ────────────────────────────────────────────
  //  MAP INITIALIZATION
  // ────────────────────────────────────────────
  const map = L.map('map', {
    center: [25.15, 55.25],
    zoom: 11,
    zoomControl: true,
    attributionControl: true
  });

  L.control.scale({ metric: true, imperial: false }).addTo(map);

  // Basemaps
  const basemaps = {
    'Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CartoDB', maxZoom: 19
    }),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri', maxZoom: 18
    }),
    'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19
    }),
  };
  basemaps['Dark'].addTo(map);
  L.control.layers(basemaps, null, { position: 'topright', collapsed: true }).addTo(map);

  // Coords display
  map.on('mousemove', (e) => {
    $('#coords-value').textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  });

  // ────────────────────────────────────────────
  //  HELPERS (Turf.js)
  // ────────────────────────────────────────────

  /**
   * Get the centroid [lng, lat] of a polygon feature
   */
  function getPolygonCenter(feature) {
    try {
      const c = turf.centroid(feature);
      return c.geometry.coordinates;
    } catch (e) {
      // Fallback: average of first ring
      const ring = feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates[0][0]
        : feature.geometry.coordinates[0];
      let sx = 0, sy = 0;
      for (const [x, y] of ring) { sx += x; sy += y; }
      return [sx / ring.length, sy / ring.length];
    }
  }

  // ────────────────────────────────────────────
  //  WIKIPEDIA API
  // ────────────────────────────────────────────
  async function fetchWikiData(query) {
    try {
      // Karena ini data Dubai, Wikipedia bahasa Inggris akan jauh lebih lengkap.
      // Kita tambahkan kata "Dubai" agar pencarian lebih akurat (menghindari hasil acak).
      const searchQuery = query.toLowerCase().includes('dubai') ? query : query + ' Dubai';
      
      let lang = 'en';
      let url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=extracts|pageimages&exintro=1&explaintext=1&pithumbsize=400&generator=search&gsrsearch=${encodeURIComponent(searchQuery)}&gsrlimit=1`;
      let res = await fetch(url);
      let data = await res.json();
      
      // Fallback ke id.wikipedia jika tidak ada di en.wikipedia
      if (!data.query || !data.query.pages || Object.keys(data.query.pages)[0] === "-1") {
        lang = 'id';
        url = `https://id.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=extracts|pageimages&exintro=1&explaintext=1&pithumbsize=400&generator=search&gsrsearch=${encodeURIComponent(searchQuery)}&gsrlimit=1`;
        res = await fetch(url);
        data = await res.json();
      }

      if (data.query && data.query.pages) {
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pageId !== "-1") {
          return {
            title: pages[pageId].title,
            extract: pages[pageId].extract,
            image: pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null,
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pages[pageId].title)}`
          };
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  let markerIdCounter = 0;

  // ────────────────────────────────────────────
  //  POPUP BUILDER
  // ────────────────────────────────────────────
  function buildPopup(props, latlng, markerId) {
    const catInfo = CATEGORY_MAP[props.kategori] || {};
    const name = props.nama || props.name || 'Tanpa Nama';
    return `<div class="popup-content">
      <div class="popup-name">${name}</div>
      <div class="popup-row"><span class="popup-label">Kategori</span><span class="popup-value">${catInfo.label || props.kategori || '-'}</span></div>
      <div class="popup-row"><span class="popup-label">Tipe</span><span class="popup-value">${props.kategori || '-'}</span></div>
      <div class="popup-row"><span class="popup-label">Koordinat</span><span class="popup-value">${latlng[0].toFixed(5)}, ${latlng[1].toFixed(5)}</span></div>
      <div id="wiki-container-${markerId}" class="wiki-container" style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <div style="font-size: 0.8rem; color: var(--text-dim); text-align: center;">Mencari info di Wikipedia... ⏳</div>
      </div>
    </div>`;
  }


  // ────────────────────────────────────────────
  //  PROCESS & RENDER FEATURES
  // ────────────────────────────────────────────
  function processFeatures(poiData, bangunanData) {
    const rendered = [];
    const categoryLayers = {};
    const categoryStats = {};

    // Helper: create marker and add to tracking
    function addMarker(props, latlng, featureType, kategori) {
      const color = getCatColor(kategori);
      const markerId = ++markerIdCounter;

      // Initialize layer group for this category if needed
      if (!categoryLayers[kategori]) {
        categoryLayers[kategori] = L.layerGroup().addTo(map);
      }
      if (!categoryStats[kategori]) {
        categoryStats[kategori] = 0;
      }

      const marker = L.circleMarker([latlng[1], latlng[0]], {
        radius: 7,
        fillColor: color,
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.85
      });

      marker.bindPopup(buildPopup(props, latlng, markerId), { maxWidth: 320 });

      const name = props.nama || props.name || '';
      if (name) {
        marker.bindTooltip(name, { direction: 'top', offset: [0, -8] });
      }

      // Auto zoom when marker is clicked
      marker.on('click', () => {
        map.flyTo([latlng[1], latlng[0]], 16, { duration: 0.8 });
      });

      // Fetch Wikipedia data when popup opens
      marker.on('popupopen', async () => {
        const container = document.getElementById(`wiki-container-${markerId}`);
        if (!container || container.dataset.loaded) return;
        
        if (!name) {
          container.innerHTML = '<div style="font-size:0.8rem;color:var(--text-dim);text-align:center;">Nama lokasi tidak tersedia.</div>';
          container.dataset.loaded = 'true';
          return;
        }

        const wikiData = await fetchWikiData(name);
        
        // Cek lagi jika popup sudah ditutup sebelum fetch selesai
        if (!document.getElementById(`wiki-container-${markerId}`)) return;

        container.dataset.loaded = 'true';
        if (wikiData) {
          let html = '';
          if (wikiData.image) {
            html += `<img src="${wikiData.image}" alt="${wikiData.title}" style="width:100%; border-radius:6px; margin-bottom:10px; max-height:180px; object-fit:cover;">`;
          }
          if (wikiData.extract) {
            const shortExtract = wikiData.extract.length > 200 ? wikiData.extract.substring(0, 200) + '...' : wikiData.extract;
            html += `<div style="font-size:0.85rem; line-height: 1.5; color: var(--text-color);">${shortExtract} <br><a href="${wikiData.url}" target="_blank" style="color: #3498db; text-decoration: none; font-weight: 500; display:inline-block; margin-top:6px;">Baca lebih lanjut di Wikipedia &rarr;</a></div>`;
          } else {
             html += `<div style="font-size:0.85rem; line-height: 1.5; color: var(--text-color);"><a href="${wikiData.url}" target="_blank" style="color: #3498db; text-decoration: none; font-weight: 500;">Lihat di Wikipedia &rarr;</a></div>`;
          }
          container.innerHTML = html;
        } else {
          container.innerHTML = `<div style="font-size:0.8rem; color:var(--text-dim); text-align:center;">Info Wikipedia tidak ditemukan.</div>`;
        }
      });

      categoryLayers[kategori].addLayer(marker);
      categoryStats[kategori]++;

      rendered.push({
        name: name,
        kategori: kategori,
        label: getCatLabel(kategori),
        color: color,
        type: featureType,   // 'poi' or 'bangunan'
        latlng: [latlng[1], latlng[0]],  // [lat, lng] for Leaflet
        marker: marker
      });
    }

    // ── Process POI (Points) ──
    if (poiData && poiData.features) {
      for (const feature of poiData.features) {
        const props = feature.properties || {};
        const kategori = props.kategori;

        // FILTER 1: Must have valid name
        if (!hasValidName(props)) continue;
        // FILTER 2: Category must be recognized
        if (!isRecognized(kategori)) continue;

        const coords = feature.geometry.coordinates; // [lng, lat]
        addMarker(props, coords, 'poi', kategori);
      }
    }

    // ── Process Buildings (Polygons) ──
    if (bangunanData && bangunanData.features) {
      for (const feature of bangunanData.features) {
        const props = feature.properties || {};
        const kategori = props.kategori;

        // FILTER 1: Must have valid name
        if (!hasValidName(props)) continue;
        // FILTER 2: Category must be recognized
        if (!isRecognized(kategori)) continue;

        const center = getPolygonCenter(feature); // [lng, lat]
        addMarker(props, center, 'bangunan', kategori);
      }
    }

    state.allRendered = rendered;
    state.filteredForDisplay = rendered;
    state.markerLayers = categoryLayers;
    state.categoryStats = categoryStats;

    // Activate all categories initially
    state.activeCategories = new Set(Object.keys(categoryStats));
  }

  // ────────────────────────────────────────────
  //  SIDEBAR: BUILD CATEGORY CHIPS
  // ────────────────────────────────────────────
  function buildCategoryChips() {
    const container = $('#category-chips');
    container.innerHTML = '';

    // Group categories by label to merge duplicates (e.g. ferry_terminal + cruise_terminal → "Pelabuhan")
    const labelGroups = {};
    for (const [kategori, count] of Object.entries(state.categoryStats)) {
      const catInfo = CATEGORY_MAP[kategori];
      if (!catInfo) continue;
      const label = catInfo.label;
      if (!labelGroups[label]) {
        labelGroups[label] = { keys: [], count: 0, color: catInfo.color, label: label };
      }
      labelGroups[label].keys.push(kategori);
      labelGroups[label].count += count;
    }

    // Sort by count (desc)
    const sorted = Object.values(labelGroups).sort((a, b) => b.count - a.count);

    for (const group of sorted) {
      const chip = document.createElement('div');
      chip.className = 'chip active';
      chip.dataset.keys = JSON.stringify(group.keys);
      chip.innerHTML = `
        <span class="chip-dot" style="background:${group.color}"></span>
        <span>${group.label}</span>
        <span class="chip-count">(${group.count})</span>
      `;

      chip.addEventListener('click', () => {
        toggleCategoryGroup(group.keys, chip);
      });

      container.appendChild(chip);
    }
  }

  function toggleCategoryGroup(keys, chipEl) {
    // Check if any key in the group is active
    const isActive = keys.some(k => state.activeCategories.has(k));

    if (isActive) {
      // Deactivate all keys in group
      for (const k of keys) {
        state.activeCategories.delete(k);
        if (state.markerLayers[k]) map.removeLayer(state.markerLayers[k]);
      }
      chipEl.classList.remove('active');
    } else {
      // Activate all keys in group
      for (const k of keys) {
        state.activeCategories.add(k);
        if (state.markerLayers[k]) map.addLayer(state.markerLayers[k]);
      }
      chipEl.classList.add('active');
    }
    applyFilters();
  }

  // ────────────────────────────────────────────
  //  SIDEBAR: FEATURE LIST
  // ────────────────────────────────────────────
  const MAX_LIST_ITEMS = 300;

  function applyFilters() {
    const q = state.searchQuery.toLowerCase().trim();
    let items = state.allRendered;

    // Filter by active categories
    items = items.filter(f => state.activeCategories.has(f.kategori));

    // Filter by search query
    if (q) {
      items = items.filter(f =>
        f.name.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.kategori.toLowerCase().includes(q)
      );
    }

    state.filteredForDisplay = items;
    renderFeatureList(items);
    updateCounter(items.length, state.allRendered.length);
  }

  function renderFeatureList(items) {
    const container = $('#feature-list');
    const shown = items.slice(0, MAX_LIST_ITEMS);

    let html = '';
    for (let i = 0; i < shown.length; i++) {
      const f = shown[i];
      const delay = Math.min(i * 15, 300);
      html += `<div class="feature-item" data-index="${i}" style="animation-delay:${delay}ms">
        <div class="feature-item-dot" style="background:${f.color}"></div>
        <div class="feature-item-info">
          <div class="feature-item-name">${f.name}</div>
          <div class="feature-item-meta">${f.label}</div>
        </div>
        <span class="feature-item-type ${f.type}">${f.type === 'poi' ? 'POI' : 'BGN'}</span>
      </div>`;
    }

    if (items.length > MAX_LIST_ITEMS) {
      html += `<div style="text-align:center;padding:12px;color:var(--text-dim);font-size:0.75rem;font-family:var(--font-mono);">
        +${items.length - MAX_LIST_ITEMS} fitur lainnya...
      </div>`;
    }

    if (items.length === 0) {
      html = `<div style="text-align:center;padding:40px 16px;color:var(--text-dim);">
        <div style="font-size:2rem;margin-bottom:8px;">🔍</div>
        <div style="font-size:0.85rem;">Tidak ada fitur ditemukan</div>
      </div>`;
    }

    container.innerHTML = html;

    // Add click handlers
    container.querySelectorAll('.feature-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        const f = state.filteredForDisplay[idx];
        if (!f) return;

        // Fly to marker
        map.flyTo(f.latlng, 16, { duration: 0.8 });
        setTimeout(() => f.marker.openPopup(), 900);

        // Highlight in list
        container.querySelectorAll('.feature-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
      });
    });
  }

  function updateCounter(shown, total) {
    $('#count-shown').textContent = shown;
    $('#count-total').textContent = total;
  }

  // ────────────────────────────────────────────
  //  SIDEBAR EVENTS
  // ────────────────────────────────────────────

  // Search
  $('#search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    const hasQuery = e.target.value.trim().length > 0;
    $('#btn-clear-search').classList.toggle('hidden', !hasQuery);
    applyFilters();
  });

  $('#btn-clear-search').addEventListener('click', () => {
    $('#search-input').value = '';
    state.searchQuery = '';
    $('#btn-clear-search').classList.add('hidden');
    applyFilters();
  });

  // Sidebar collapse/expand
  $('#btn-collapse-sidebar').addEventListener('click', () => {
    $('#sidebar').classList.add('collapsed');
    $('#btn-expand-sidebar').classList.remove('hidden');
    setTimeout(() => map.invalidateSize(), 350);
  });

  $('#btn-expand-sidebar').addEventListener('click', () => {
    $('#sidebar').classList.remove('collapsed');
    $('#btn-expand-sidebar').classList.add('hidden');
    setTimeout(() => map.invalidateSize(), 350);
  });

  // ────────────────────────────────────────────
  //  LOAD DATA
  // ────────────────────────────────────────────
  async function loadData() {
    try {
      setLoadingStatus('Memuat data POI...', 35);
      const poiRes = await fetch('data/poi_dubai.geojson');
      if (!poiRes.ok) throw new Error('Gagal memuat poi_dubai.geojson');
      const poiData = await poiRes.json();

      setLoadingStatus('Memuat data bangunan...', 55);
      const bldRes = await fetch('data/bangunan_dubai.geojson');
      if (!bldRes.ok) throw new Error('Gagal memuat bangunan_dubai.geojson');
      const bangunanData = await bldRes.json();

      setLoadingStatus('Merender marker...', 70);

      // Process features
      processFeatures(poiData, bangunanData);

      setLoadingStatus('Membangun sidebar...', 90);

      // Build UI
      buildCategoryChips();
      applyFilters();

      // Zoom to features
      const bounds = L.latLngBounds();
      Object.values(state.markerLayers).forEach(layerGroup => {
        layerGroup.eachLayer(layer => {
          if (layer.getLatLng) {
            bounds.extend(layer.getLatLng());
          }
        });
      });
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }

      hideLoading();

      const totalRendered = state.allRendered.length;
      const totalRaw = (poiData.features?.length || 0) + (bangunanData.features?.length || 0);
      toast(
        `✅ ${totalRendered} fitur ditampilkan dari ${totalRaw} total`,
        'success',
        5000
      );

    } catch (err) {
      console.error('Load error:', err);
      setLoadingStatus('❌ Gagal memuat data!', 100);
      toast('Error: ' + err.message, 'error', 8000);
    }
  }

  // ────────────────────────────────────────────
  //  START
  // ────────────────────────────────────────────
  loadData();

})();
