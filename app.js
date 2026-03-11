// app.js — StoreMap · Almacén de Papel

const WAREHOUSE_LAYOUT = [
    { id: 'col-left',     blocks: [
        { id: 'nave1-der', name: 'N1 Derecho (1-17)',    start: 1,  end: 17 },
        { id: 'nave1-izq', name: 'N1 Izquierdo (43-55)', start: 43, end: 55 },
        { id: 'taller',  name: 'Taller',    isExternal: true, extId: 'TALLER'  },
        { id: 'digital', name: 'Digital',   isExternal: true, extId: 'DIGITAL' },
        { id: 'monge',   name: 'Monge',     isExternal: true, extId: 'MONGE'   }
    ]},
    { id: 'col-center',   blocks: [
        { id: 'nave2-der', name: 'N2 Derecho (18-42)',   start: 18, end: 42 },
        { id: 'nave2-cen', name: 'N2 Central (63-75)',   start: 63, end: 75 },
        { id: 'nave2-izq', name: 'N2 Izquierdo (81-76)', start: 81, end: 76 }
    ]}
];

const allAislesData = {};
let totalGlobalCapacity = 0;
let localSeedData = {};
let globalClickListenerAttached = false;
const activityLog = [];
let _catalogCache = null;
let _catalogDirty = true;
function invalidateCatalog() { _catalogDirty = true; }

// ─── CONFIG LOCAL (localStorage) ─────────────────────────────────────────────
// aisleConfig[aisleId] = { disabled, capacity }
// articleConfig[refId] = { kgPerPalet }  ← ahora por artículo, no por pasillo
let aisleConfig   = {};
let articleConfig = {};  // refId → { kgPerPalet: number, notes: string }

function loadConfig() {
    try { aisleConfig   = JSON.parse(localStorage.getItem('sm_aisleConfig')   || '{}'); } catch(e) { aisleConfig   = {}; }
    try { articleConfig = JSON.parse(localStorage.getItem('sm_articleConfig') || '{}'); } catch(e) { articleConfig = {}; }
}
function saveAisleConfig()   { localStorage.setItem('sm_aisleConfig',   JSON.stringify(aisleConfig));   }
function saveArticleConfig() { localStorage.setItem('sm_articleConfig', JSON.stringify(articleConfig)); }
function getAisleCfg(id)   { if (!aisleConfig[id])   aisleConfig[id]   = {}; return aisleConfig[id]; }
function getArticleCfg(id) { if (!articleConfig[id]) articleConfig[id] = {}; return articleConfig[id]; }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getKgPerPalet(refId) {
    return (articleConfig[refId] && articleConfig[refId].kgPerPalet > 0)
        ? articleConfig[refId].kgPerPalet
        : 600;
}

function calcTotalKilos(items) {
    if (!items || !items.length) return 0;
    return items.reduce((s, it) => {
        const kg = Math.max(0, it.hojas || 0);
        return s + kg;
    }, 0);
}

// Palets reales usando kg/palet de la config de artículo
function calcPalets(items) {
    if (!items || !items.length) return 0;
    return items.reduce((s, it) => {
        const kg = Math.max(0, it.hojas || 0);
        return s + (kg / getKgPerPalet(it.id));
    }, 0);
}

function getCapacity(aisle) {
    return (aisleConfig[aisle.id] && aisleConfig[aisle.id].capacity) || aisle.capacity;
}
function isDisabled(aisle) { return !!(aisleConfig[aisle.id] || {}).disabled; }
function getHeatmapClass(r) { return r < 30 ? 'empty' : r <= 75 ? 'medium' : 'full'; }
function getHeatmapColorHex(r) { return r < 30 ? '#22c55e' : r <= 75 ? '#f59e0b' : '#ef4444'; }
function fmtNum(n) { return Number(n).toLocaleString('es-ES'); }
function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

// ─── EXTRAER GRAMAJE DESDE CÓDIGO ─────────────────────────────────────────────
function extractGramaje(codigo) {
    const m = codigo.match(/^1(\d+)[A-Za-z]/);
    if (m) {
        const num = parseInt(m[1], 10);
        if (num > 0 && num < 2000) return `${num}g`;
    }
    return '-';
}

// ─── CATÁLOGO GLOBAL DE ARTÍCULOS ─────────────────────────────────────────────
// Construye un mapa refId → { id, tipo, gramaje, proveedor, totalKilos, palets, aisles[] }
function buildCatalog() {
    if (!_catalogDirty && _catalogCache) return _catalogCache;
    const cat = {};
    Object.values(allAislesData).forEach(aisle => {
        (aisle.items || []).forEach(it => {
            // Determinar gramaje: primero intentar del código, luego del dato original
            let gramaje = it.gramaje || '';
            if (!gramaje || gramaje === '-') gramaje = extractGramaje(it.id || '');

            if (!cat[it.id]) cat[it.id] = {
                id: it.id, tipo: it.tipo || '', gramaje: gramaje,
                proveedor: it.proveedor || '', totalKilos: 0, totalHojas: 0,
                palets: 0, aisles: new Set()
            };
            cat[it.id].totalKilos += Math.max(0, it.hojas || 0);
            cat[it.id].totalHojas += Math.max(0, it.kilos || 0);
            cat[it.id].palets     += Math.max(0, it.hojas || 0) / getKgPerPalet(it.id);
            cat[it.id].aisles.add(aisle.id);
        });
    });
    // Convertir sets a arrays
    Object.values(cat).forEach(a => { a.aisles = [...a.aisles].sort(); });
    _catalogCache = cat;
    _catalogDirty = false;
    return cat;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initMockData() {
    loadConfig();
    // Cargar seed.json
    try {
        const resp = await fetch('./seed.json');
        if (resp.ok) localSeedData = await resp.json();
    } catch(e) { console.log('No seed.json', e); }
    // Cargar article_config.json (kg/palet desde Excel)
    // Solo carga valores que NO estén ya en localStorage (localStorage tiene prioridad)
    try {
        const resp2 = await fetch('./article_config.json');
        if (resp2.ok) {
            const fileConfig = await resp2.json();
            let merged = 0;
            Object.entries(fileConfig).forEach(([refId, cfg]) => {
                // Solo aplicar si no hay un valor manual en localStorage
                if (!articleConfig[refId] || !articleConfig[refId].kgPerPalet) {
                    getArticleCfg(refId).kgPerPalet = cfg.kgPerPalet;
                    merged++;
                }
            });
            if (merged > 0) console.log(`Cargados ${merged} kg/palet desde article_config.json`);
        }
    } catch(e) { console.log('No article_config.json', e); }

    WAREHOUSE_LAYOUT.forEach(col => col.blocks.forEach(block => {
        if (block.type === 'empty') return;
        const list = [];
        if (block.isExternal) {
            const id  = block.extId;
            const obj = { id, capacity: 500, items: localSeedData[id]?.items || [], blockId: block.id };
            list.push(obj); allAislesData[id] = obj; totalGlobalCapacity += 500;
        } else {
            const asc = block.start <= block.end, step = asc ? 1 : -1;
            for (let i = block.start; asc ? i <= block.end : i >= block.end; i += step) {
                const id  = String(i).padStart(2, '0');
                const obj = { id, capacity: 24, items: localSeedData[id]?.items || [], blockId: block.id };
                list.push(obj); allAislesData[id] = obj; totalGlobalCapacity += 24;
            }
        }
        block.aisles = list;
    }));
    addLog('system', 'Almacén cargado desde seed.json');
}

// ─── RENDER MAPA ─────────────────────────────────────────────────────────────
function renderWarehouse() {
    const gridEl = document.getElementById('warehouse-grid');
    gridEl.innerHTML = '';
    let totalFilled = 0, totalCap = 0;

    WAREHOUSE_LAYOUT.forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'layout-column';
        colEl.id = col.id; // allows CSS #col-left / #col-center targeting

        col.blocks.forEach(block => {
            const blockEl = document.createElement('div');
            if (block.type === 'empty') { blockEl.className = 'layout-block empty-block'; colEl.appendChild(blockEl); return; }

            blockEl.className = 'layout-block';
            let html = `<div class="aisle-header"><span class="aisle-title">${block.name}</span></div>
                        <div class="racks-container ${block.isExternal ? 'single-col' : ''}">`;

            block.aisles.forEach(aisle => {
                const disabled = isDisabled(aisle);
                const cap = getCapacity(aisle);
                const pal = parseFloat(calcPalets(aisle.items).toFixed(1));
                if (!disabled) { totalFilled += pal; totalCap += cap; }
                const occ  = cap > 0 ? (pal / cap) * 100 : 0;
                const heat = disabled ? 'disabled' : getHeatmapClass(occ);
                html += `
                    <div class="rack aisle-unit ${heat}" data-id="${aisle.id}"
                         title="${disabled ? '⛔ Anulado' : `P${aisle.id} · ${pal} pal. · ${Math.round(occ)}%`}">
                        ${disabled ? '<i class="ri-forbid-line" style="font-size:10px;color:#4b5563;z-index:1;"></i>' : ''}
                        <span class="rack-id" style="${disabled?'color:#4b5563;':''}">${aisle.id}</span>
                        <span class="aisle-badge" style="${disabled?'color:#374151;':''}">${disabled ? 'anulado' : pal+' pal.'}</span>
                    </div>`;
            });

            html += '</div>';
            blockEl.innerHTML = html;
            colEl.appendChild(blockEl);
        });
        gridEl.appendChild(colEl);
    });

    updateGlobalMetrics(totalFilled, totalCap);
    attachAisleListeners();
}

function updateGlobalMetrics(filled, total) {
    const rate = total === 0 ? 0 : (filled / total) * 100;
    const el   = document.getElementById('global-ocupation');
    const bar  = document.getElementById('global-progress');
    if (!el || !bar) return;
    el.textContent = `${Math.round(rate)}%`;
    bar.style.width = `${Math.min(rate, 100)}%`;
    const c = getHeatmapColorHex(rate);
    el.style.color = c; bar.style.backgroundColor = c;
}

// ─── LISTENERS ────────────────────────────────────────────────────────────────
function attachAisleListeners() {
    const grid = document.getElementById('warehouse-grid');
    if (!grid._delegated) {
        grid.addEventListener('click', e => {
            const unit = e.target.closest('.aisle-unit');
            if (!unit) return;
            e.stopPropagation();
            document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
            unit.classList.add('active');
            const data = allAislesData[unit.getAttribute('data-id')];
            if (data) showInspector(data);
        });
        grid._delegated = true;
    }
    if (!globalClickListenerAttached) {
        document.addEventListener('click', e => {
            if (!e.target.closest('.aisle-unit') && !e.target.closest('#inspector-panel') && !e.target.closest('#edit-modal') && !e.target.closest('#search-dropdown')) {
                closeInspector();
            }
        });
        globalClickListenerAttached = true;
    }
}

// ─── INSPECTOR ────────────────────────────────────────────────────────────────
function closeInspector() {
    document.getElementById('inspector-panel').classList.remove('visible');
    document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
}

function showInspector(aisleData) {
    const panel    = document.getElementById('inspector-panel');
    panel.className = 'inspector-panel';

    const disabled = isDisabled(aisleData);
    const cap = getCapacity(aisleData);
    const pal = parseFloat(calcPalets(aisleData.items).toFixed(1));
    const occ = cap > 0 ? (pal / cap) * 100 : 0;
    const col = disabled ? '#6b7280' : getHeatmapColorHex(occ);

    // Agrupar items por ref
    const grouped = {};
    (aisleData.items || []).forEach(it => {
        if (!grouped[it.id]) grouped[it.id] = { ...it, totalKilos: 0, totalHojas: 0 };
        grouped[it.id].totalKilos += Math.max(0, it.hojas || 0);
        grouped[it.id].totalHojas += Math.max(0, it.kilos || 0);
    });
    const rows = Object.values(grouped).sort((a, b) => b.totalKilos - a.totalKilos);

    const statusBadge = disabled
        ? `<span class="insp-badge" style="background:#374151;color:#9ca3af;">⛔ Pasillo Anulado — no cuenta en métricas</span>`
        : `<span class="insp-badge" style="background:${col}22;color:${col};">${Math.round(occ)}% · ${pal} / ${cap} pal.</span>`;

    let html = `
        <div class="inspector-header">
            <div>
                <h3 class="insp-title">Pasillo ${aisleData.id}</h3>
                ${statusBadge}
            </div>
            <div style="display:flex;gap:6px;align-items:flex-start;">
                <button class="insp-action-btn" data-action="edit" title="Editar configuración"><i class="ri-settings-3-line"></i></button>
                <button class="insp-action-btn ${disabled?'btn-enable':'btn-disable'}" data-action="toggle" title="${disabled?'Activar':'Anular'}"><i class="ri-${disabled?'checkbox-circle-line':'forbid-line'}"></i></button>
                <button class="insp-action-btn btn-close" data-action="close" title="Cerrar"><i class="ri-close-line"></i></button>
            </div>
        </div>
        <div class="items-list-container">`;

    if (rows.length > 0) {
        html += `<table class="items-table">
            <thead><tr>
                <th>Código</th><th>Descripción</th>
                <th class="text-right">Pliegos</th>
                <th class="text-right">Kg</th>
                <th class="text-right">Kg/pal</th>
                <th class="text-center">Pal. est.</th>
            </tr></thead><tbody>`;
        rows.forEach(g => {
            const kgPP  = getKgPerPalet(g.id);
            const palEst = (g.totalKilos / kgPP).toFixed(1);
            const isCustom = !!(articleConfig[g.id] && articleConfig[g.id].kgPerPalet > 0);
            html += `<tr>
                <td class="ref-code">${esc(g.id)}</td>
                <td class="ref-desc">${esc(g.tipo)}</td>
                <td class="text-right mono-sm">${fmtNum(g.totalHojas)}</td>
                <td class="text-right mono-sm" style="color:#9ca3af;">${fmtNum(Math.round(g.totalKilos))}</td>
                <td class="text-right mono-sm">
                    <span style="${isCustom?'color:var(--accent);font-weight:700;':'color:#6b7280;'}">${fmtNum(kgPP)}</span>
                </td>
                <td class="text-center"><span class="pal-badge">${palEst}</span></td>
            </tr>`;
        });
        html += `</tbody></table>`;
    } else {
        html += `<div class="empty-state"><i class="ri-inbox-line"></i><p>Pasillo vacío</p></div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;
    panel.querySelector('[data-action="edit"]')?.addEventListener('click', () => openEditModal(aisleData.id));
    panel.querySelector('[data-action="toggle"]')?.addEventListener('click', () => toggleAisleDisabled(aisleData.id));
    panel.querySelector('[data-action="close"]')?.addEventListener('click', closeInspector);
    panel.classList.add('visible');
}

// ─── TOGGLE ANULAR ────────────────────────────────────────────────────────────
function toggleAisleDisabled(id) {
    const cfg = getAisleCfg(id);
    cfg.disabled = !cfg.disabled;
    saveAisleConfig();
    addLog(cfg.disabled ? 'disable' : 'enable', `Pasillo ${cfg.disabled?'anulado':'reactivado'}: P${id}`, id);
    renderWarehouse();
    showInspector(allAislesData[id]);
}

// ─── MODAL EDICIÓN PASILLO ────────────────────────────────────────────────────
function openEditModal(id) {
    const aisle = allAislesData[id];
    const cfg   = getAisleCfg(id);
    const cap   = cfg.capacity || aisle.capacity;

    const modal = document.getElementById('edit-modal');
    modal.innerHTML = `
        <div class="edit-modal-box">
            <div class="edit-modal-header">
                <h3><i class="ri-settings-3-line"></i> Configurar Pasillo ${id}</h3>
                <button class="insp-action-btn btn-close" data-action="close"><i class="ri-close-line"></i></button>
            </div>
            <div class="edit-modal-body">
                <div class="edit-section">
                    <label class="edit-label">Capacidad máxima (palets)</label>
                    <input type="number" id="edit-capacity" min="1" max="9999" class="edit-input" value="${cap}" placeholder="${aisle.capacity}">
                    <span class="edit-hint">Por defecto: ${aisle.capacity} palets</span>
                </div>
                <div class="edit-section">
                    <label class="edit-label">Kg/palet por artículo</label>
                    <span class="edit-hint">Configura en el <strong>Menú Artículos</strong> → columna Kg/pal</span>
                </div>
            </div>
            <div class="edit-modal-footer">
                <button class="btn-secondary" data-action="reset"><i class="ri-refresh-line"></i> Restaurar</button>
                <button class="btn-primary" data-action="save"><i class="ri-save-line"></i> Guardar</button>
            </div>
        </div>`;
    // Stop propagation on the box to prevent modal backdrop click from closing
    modal.querySelector('.edit-modal-box')?.addEventListener('click', e => e.stopPropagation());
    modal.querySelector('[data-action="close"]')?.addEventListener('click', closeEditModal);
    modal.querySelector('[data-action="reset"]')?.addEventListener('click', () => resetAisleCfg(id));
    modal.querySelector('[data-action="save"]')?.addEventListener('click', () => saveEditModal(id));
    modal.classList.add('visible');
}
function closeEditModal() { document.getElementById('edit-modal').classList.remove('visible'); }
function saveEditModal(id) {
    const cfg = getAisleCfg(id);
    const v   = parseInt(document.getElementById('edit-capacity').value);
    if (v > 0) cfg.capacity = v;
    saveAisleConfig();
    addLog('edit', `P${id} — capacidad actualizada a ${v}`, id);
    closeEditModal();
    renderWarehouse();
    showInspector(allAislesData[id]);
}
function resetAisleCfg(id) {
    if (!confirm(`¿Restaurar configuración por defecto del pasillo ${id}?`)) return;
    delete aisleConfig[id];
    saveAisleConfig();
    addLog('edit', `P${id} — restaurado`, id);
    closeEditModal();
    renderWarehouse();
    showInspector(allAislesData[id]);
}

// ─── BÚSQUEDA CON AUTOCOMPLETADO ──────────────────────────────────────────────
function setupSearch() {
    const inp      = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    const dropdown = document.getElementById('search-dropdown');
    if (!inp) return;

    function clearSearch() {
        inp.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        hideDropdown();
        document.querySelectorAll('.aisle-unit').forEach(el => { el.style.opacity = '1'; el.style.outline = ''; });
        closeInspector();
        inp.focus();
    }
    if (clearBtn) clearBtn.addEventListener('click', clearSearch);

    function hideDropdown() { if (dropdown) dropdown.style.display = 'none'; }

    function showDropdown(results) {
        if (!dropdown || !results.length) { hideDropdown(); return; }
        dropdown.innerHTML = '';
        results.slice(0, 12).forEach(r => {
            const item = document.createElement('div');
            item.className = 'search-dd-item';
            const aisleList = r.aisles.map(a => `<span class="dd-aisle-tag dd-aisle-link" data-aisle="${a}">P${a}</span>`).join('');
            item.innerHTML = `
                <div class="dd-main">
                    <span class="dd-tipo">${esc(r.tipo)}</span>
                    <span class="dd-code">${esc(r.id)}</span>
                </div>
                <div class="dd-meta">
                    <span class="dd-kilos">${fmtNum(Math.round(r.totalKilos))} kg · ${r.palets.toFixed(1)} pal. total</span>
                    <div class="dd-aisles">${aisleList}</div>
                </div>`;

            // Clic en tag de pasillo → ir al pasillo directamente
            item.querySelectorAll('.dd-aisle-link').forEach(tag => {
                tag.addEventListener('click', e => {
                    e.stopPropagation();
                    const aid = tag.getAttribute('data-aisle');
                    inp.value = r.tipo;
                    if (clearBtn) clearBtn.style.display = 'flex';
                    hideDropdown();
                    highlightAisles(new Set(r.aisles));
                    const el = document.querySelector(`.aisle-unit[data-id="${aid}"]`);
                    if (el) { document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active')); el.classList.add('active'); }
                    showInspector(allAislesData[aid]);
                });
            });

            // Clic en el item → abrir ficha completa del artículo
            item.addEventListener('click', e => {
                if (e.target.closest('.dd-aisle-link')) return; // ya gestionado
                e.stopPropagation();
                inp.value = r.tipo;
                if (clearBtn) clearBtn.style.display = 'flex';
                hideDropdown();
                highlightAisles(new Set(r.aisles));
                showArticleCard(r);
            });

            dropdown.appendChild(item);
        });
        if (results.length > 12) {
            const more = document.createElement('div');
            more.className = 'search-dd-more';
            more.textContent = `+${results.length - 12} resultados más…`;
            dropdown.appendChild(more);
        }
        dropdown.style.display = 'block';
    }

    function highlightAisles(aisleSet) {
        document.querySelectorAll('.aisle-unit').forEach(el => {
            const id = el.getAttribute('data-id');
            if (aisleSet.has(id)) { el.style.opacity = '1'; el.style.outline = '2px solid var(--accent)'; el.style.outlineOffset = '1px'; }
            else { el.style.opacity = '0.15'; el.style.outline = ''; }
        });
    }

    inp.addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

        if (!q) {
            document.querySelectorAll('.aisle-unit').forEach(el => { el.style.opacity = '1'; el.style.outline = ''; });
            hideDropdown();
            return;
        }

        const cat = buildCatalog();
        const results = Object.values(cat).filter(r =>
            r.tipo.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q)   ||
            r.gramaje.toLowerCase().includes(q) ||
            r.proveedor.toLowerCase().includes(q)
        ).sort((a, b) => b.totalKilos - a.totalKilos);

        showDropdown(results);

        // Iluminar todos los pasillos que contienen algún resultado
        const allMatchAisles = new Set();
        results.forEach(r => r.aisles.forEach(a => allMatchAisles.add(a)));
        highlightAisles(allMatchAisles);
    });

    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') clearSearch();
    });

    // Cerrar dropdown al clicar fuera
    document.addEventListener('click', e => {
        if (!e.target.closest('#search-dropdown') && !e.target.closest('.sidebar-search')) hideDropdown();
    }, { capture: false });
}

// ─── FICHA DE ARTÍCULO (desde búsqueda) ──────────────────────────────────────
function showArticleCard(ref) {
    const panel = document.getElementById('inspector-panel');
    panel.className = 'inspector-panel inspector-article';

    const kgPP     = getKgPerPalet(ref.id);
    const isCustom = !!(articleConfig[ref.id] && articleConfig[ref.id].kgPerPalet > 0);

    // Desglose por pasillo
    const aisleBreakdown = ref.aisles.map(aid => {
        const aisle = allAislesData[aid];
        if (!aisle) return null;
        const items = (aisle.items || []).filter(it => it.id === ref.id);
        const kg    = items.reduce((s, it) => s + Math.max(0, it.hojas || 0), 0);
        const hojas = items.reduce((s, it) => s + Math.max(0, it.kilos || 0), 0);
        const pal   = kg / kgPP;
        const cap   = getCapacity(aisle);
        const occ   = (calcPalets(aisle.items) / cap) * 100;
        return { aid, kg, hojas, pal, occ, disabled: isDisabled(aisle) };
    }).filter(Boolean).sort((a, b) => b.kg - a.kg);

    let html = `
        <div class="inspector-header">
            <div style="flex:1;min-width:0;">
                <div class="section-label" style="margin-bottom:4px;">
                    <i class="ri-archive-2-line"></i> FICHA DE ARTÍCULO
                </div>
                <h3 class="insp-title" style="font-size:13px;line-height:1.35;">${esc(ref.tipo)}</h3>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center;">
                    <span class="insp-badge" style="background:rgba(99,102,241,0.12);color:var(--accent);">${esc(ref.id)}</span>
                    ${ref.gramaje ? `<span class="insp-badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted);">${esc(ref.gramaje)}</span>` : ''}
                    ${ref.proveedor ? `<span class="insp-badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted);">${esc(ref.proveedor)}</span>` : ''}
                    <span class="insp-badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted);">
                        ${isCustom ? `<span style="color:var(--accent);font-weight:700;">${fmtNum(kgPP)}</span>` : fmtNum(kgPP)} kg/palet
                    </span>
                </div>
            </div>
            <button class="insp-action-btn btn-close" data-action="close" title="Cerrar"><i class="ri-close-line"></i></button>
        </div>

        <!-- Totales -->
        <div class="art-card-totals">
            <div class="art-card-stat">
                <span class="art-card-stat-val">${fmtNum(Math.round(ref.totalKilos))}</span>
                <span class="art-card-stat-lbl">kg totales</span>
            </div>
            <div class="art-card-stat">
                <span class="art-card-stat-val">${ref.palets.toFixed(1)}</span>
                <span class="art-card-stat-lbl">palets est.</span>
            </div>
            <div class="art-card-stat">
                <span class="art-card-stat-val">${fmtNum(ref.totalHojas)}</span>
                <span class="art-card-stat-lbl">pliegos</span>
            </div>
            <div class="art-card-stat">
                <span class="art-card-stat-val">${aisleBreakdown.length}</span>
                <span class="art-card-stat-lbl">${aisleBreakdown.length === 1 ? 'pasillo' : 'pasillos'}</span>
            </div>
        </div>

        <!-- Desglose por pasillo -->
        <div class="items-list-container">
            <div class="section-label" style="margin-bottom:8px;">
                Distribución por pasillo
            </div>
            <table class="items-table">
                <thead><tr>
                    <th>Pasillo</th>
                    <th class="text-right">Kg</th>
                    <th class="text-right">Pliegos</th>
                    <th class="text-right">Pal. est.</th>
                    <th>Ocup. pasillo</th>
                </tr></thead>
                <tbody>`;

    aisleBreakdown.forEach(row => {
        const col  = getHeatmapColorHex(row.occ);
        const pct  = Math.round(row.occ);
        html += `<tr style="cursor:pointer;" data-aisle="${row.aid}">
            <td>
                <span class="dd-aisle-tag" style="cursor:pointer;">P${row.aid}</span>
                ${row.disabled ? '<span style="color:#6b7280;font-size:10px;margin-left:4px;">anulado</span>' : ''}
            </td>
            <td class="text-right mono-sm">${fmtNum(Math.round(row.kg))}</td>
            <td class="text-right mono-sm c-muted">${fmtNum(row.hojas)}</td>
            <td class="text-right">
                <span class="pal-badge">${row.pal.toFixed(1)}</span>
            </td>
            <td>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;min-width:50px;">
                        <div style="height:4px;border-radius:2px;background:${col};width:${Math.min(pct,100)}%;"></div>
                    </div>
                    <span style="font-size:10px;color:${col};font-family:var(--font-mono);font-weight:700;min-width:28px;">${pct}%</span>
                </div>
            </td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    panel.innerHTML = html;
    panel.querySelector('[data-action="close"]')?.addEventListener('click', closeInspector);
    panel.querySelectorAll('tr[data-aisle]').forEach(tr => {
        tr.addEventListener('click', () => goToAisleFromCard(tr.dataset.aisle));
    });
    panel.classList.add('visible');
}

function goToAisleFromCard(id) {
    closeInspector();
    setTimeout(() => {
        // Cambiar a vista mapa si no estamos en ella
        const mapBtn = document.querySelector('[data-view="map"]');
        if (mapBtn && !document.getElementById('view-map').style.display.includes('flex')) mapBtn.click();
        setTimeout(() => {
            const el = document.querySelector(`.aisle-unit[data-id="${id}"]`);
            if (el) {
                document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                showInspector(allAislesData[id]);
            }
        }, 80);
    }, 50);
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────────────────────
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ['map','metrics','history','articles'].forEach(v => {
                const el = document.getElementById(`view-${v}`);
                if (el) el.style.display = v === view ? 'flex' : 'none';
            });
            if (view === 'metrics')  renderMetrics();
            if (view === 'history')  renderHistory();
            if (view === 'articles') renderArticles();
            closeInspector();
        });
    });
    document.getElementById('view-map').style.display      = 'flex';
    document.getElementById('view-metrics').style.display  = 'none';
    document.getElementById('view-history').style.display  = 'none';
    document.getElementById('view-articles').style.display = 'none';
}

// ─── VISTA MÉTRICAS ───────────────────────────────────────────────────────────
function renderMetrics() {
    const aisles = Object.values(allAislesData);
    let totalKg=0, totalPal=0, totalItems=0, ocupados=0, vacios=0, saturados=0, anulados=0;
    
    // Calcular KPIs Globales
    aisles.forEach(a => {
        if (isDisabled(a)) { anulados++; return; }
        const kg  = calcTotalKilos(a.items);
        const pal = calcPalets(a.items);
        const occ = (pal / getCapacity(a)) * 100;
        totalKg += kg; totalPal += pal; totalItems += (a.items?.length||0);
        if (kg>0) ocupados++; else vacios++;
        if (occ>75) saturados++;
    });

    // 1. Render KPIs
    const kpisEl = document.getElementById('metrics-kpis');
    if (kpisEl) {
        kpisEl.innerHTML = `
            <div class="metric-card"><div class="metric-label">Total Kilos</div><div class="metric-value" style="color:var(--accent)">${fmtNum(Math.round(totalKg))}</div><div class="metric-sub">en almacén</div></div>
            <div class="metric-card"><div class="metric-label">Palets Est.</div><div class="metric-value">${fmtNum(Math.round(totalPal))}</div><div class="metric-sub">total estimado</div></div>
            <div class="metric-card"><div class="metric-label">Referencias</div><div class="metric-value">${fmtNum(totalItems)}</div><div class="metric-sub">líneas de stock</div></div>
            <div class="metric-card"><div class="metric-label">Ocupados</div><div class="metric-value" style="color:var(--heat-medium)">${ocupados}</div><div class="metric-sub">con stock</div></div>
            <div class="metric-card"><div class="metric-label">Vacíos</div><div class="metric-value" style="color:var(--heat-empty)">${vacios}</div><div class="metric-sub">libres</div></div>
            <div class="metric-card"><div class="metric-label">Anulados</div><div class="metric-value" style="color:#6b7280">${anulados}</div><div class="metric-sub">fuera de cálculo</div></div>`;
    }

    // 2. Top Pasillos
    const sortedAisles = aisles.filter(a=>!isDisabled(a)).map(a => {
        const pal = parseFloat(calcPalets(a.items).toFixed(1));
        const occ = Math.round((pal/getCapacity(a))*100);
        return { id:a.id, pal, occ };
    }).filter(a=>a.pal>0).sort((a,b)=>b.occ-a.occ).slice(0,10); // Reducir a Top 10
    
    const maxPal = Math.max(...sortedAisles.map(a=>a.pal), 1);
    const topBody = document.getElementById('metrics-top-body');
    if (topBody) {
        topBody.innerHTML = sortedAisles.map((a, i) => {
            const c = getHeatmapColorHex(a.occ);
            // Pequeño delay de transición para la barra
            setTimeout(() => {
                const el = topBody.querySelector(`[data-aisle="${a.id}"] .row-bar`);
                if (el) el.style.width = `${Math.min((a.pal/maxPal)*100,100)}%`;
            }, 50 + (i * 30));

            return `<div class="top-list-row" data-aisle="${a.id}">
                <span class="row-id">P${a.id}</span>
                <div class="row-bar-wrap"><div class="row-bar" style="width:0;background:${c};"></div></div>
                <span class="row-palets">${a.pal} pal.</span>
                <span class="row-pct" style="color:${c};">${a.occ}%</span>
            </div>`;
        }).join('');
        
        if (!topBody._delegated) {
            topBody.addEventListener('click', e => {
                const row = e.target.closest('.top-list-row[data-aisle]');
                if (row) goToAisle(row.dataset.aisle);
            });
            topBody._delegated = true;
        }
    }

    // 3. Top Artículos (Catálogo global)
    const cat = buildCatalog();
    const articles = Object.values(cat).sort((a, b) => b.palets - a.palets).slice(0, 10);
    const topArticlesBody = document.getElementById('metrics-top-articles-body');
    if (topArticlesBody) {
        topArticlesBody.innerHTML = articles.map(art => {
            return `<div class="top-list-row article-row">
                <div class="row-desc" title="${esc(art.tipo)}">${esc(art.tipo)}<span>${esc(art.id)}</span></div>
                <span class="row-palets" style="color:var(--text-main);font-weight:700;">${art.palets.toFixed(1)} pal.</span>
            </div>`;
        }).join('');
    }

    // 4. Distribución por Gramaje
    const grammages = {};
    Object.values(cat).forEach(art => {
        const g = art.gramaje?.trim() || 'Sin definir';
        if (!grammages[g]) grammages[g] = { label: g, palets: 0, kilos: 0 };
        grammages[g].palets += art.palets;
        grammages[g].kilos += art.totalKilos;
    });

    const gramList = Object.values(grammages)
        .filter(g => g.palets > 0)
        .sort((a, b) => b.palets - a.palets).slice(0, 10); // Top 10 gramajes
    const maxGramPal = Math.max(...gramList.map(g => g.palets), 1);

    const gramBody = document.getElementById('metrics-grammages-body');
    if (gramBody) {
        gramBody.innerHTML = gramList.map((g, i) => {
            setTimeout(() => {
                const el = gramBody.querySelector(`[data-gram="${esc(g.label)}"] .row-bar`);
                if (el) el.style.width = `${Math.min((g.palets/maxGramPal)*100, 100)}%`;
            }, 50 + (i * 30));

            return `<div class="top-list-row grammage-row" data-gram="${esc(g.label)}">
                <span class="row-gram">${esc(g.label)}</span>
                <div class="row-bar-wrap"><div class="row-bar" style="width:0;background:var(--heat-empty);"></div></div>
                <span class="row-palets">${g.palets.toFixed(1)} pal.</span>
            </div>`;
        }).join('');
    }
}

function goToAisle(id) {
    document.querySelector('[data-view="map"]').click();
    setTimeout(() => {
        const el = document.querySelector(`.aisle-unit[data-id="${id}"]`);
        if (el) { document.querySelectorAll('.aisle-unit.active').forEach(a=>a.classList.remove('active')); el.classList.add('active'); el.scrollIntoView({behavior:'smooth',block:'center'}); showInspector(allAislesData[id]); }
    }, 100);
}

// ─── VISTA ARTÍCULOS ──────────────────────────────────────────────────────────
let articleSortCol = 'totalKilos', articleSortDir = -1, articleSearch = '';

function renderArticles() {
    const cat = buildCatalog();
    let rows = Object.values(cat);

    // Filtro
    if (articleSearch) {
        const q = articleSearch.toLowerCase();
        rows = rows.filter(r =>
            r.tipo.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q) ||
            r.proveedor.toLowerCase().includes(q) ||
            r.gramaje.toLowerCase().includes(q)
        );
    }

    // Ordenar
    rows.sort((a, b) => {
        let va = a[articleSortCol], vb = b[articleSortCol];
        if (typeof va === 'string') return articleSortDir * va.localeCompare(vb);
        return articleSortDir * (va - vb);
    });

    const thead = (col, label, align='left') => {
        const active = articleSortCol === col;
        const icon   = active ? (articleSortDir === 1 ? '↑' : '↓') : '';
        return `<th class="art-th ${active?'active':''}" style="text-align:${align};cursor:pointer;" data-sort="${col}">${label} ${icon}</th>`;
    };

    const container = document.getElementById('view-articles');
    // Toolbar
    let html = `
        <div class="canvas-header" style="flex-shrink:0;">
            <h2>Artículos <span style="font-size:12px;color:var(--text-muted);font-weight:400;">(${rows.length})</span></h2>
            <div style="display:flex;gap:8px;align-items:center;">
                <div class="art-search-wrap">
                    <i class="ri-search-line" style="color:var(--text-muted);font-size:13px;"></i>
                    <input type="text" id="art-search-input" class="art-search-input" placeholder="Filtrar artículos..." value="${articleSearch}">
                </div>
                <button class="btn-secondary" style="font-size:11px;padding:5px 10px;" data-action="import" title="Importar kg/palet desde Excel">
                    <i class="ri-upload-2-line"></i> Importar Excel
                </button>
                <input type="file" id="art-excel-input" accept=".xls,.xlsx" style="display:none">
            </div>
        </div>
        <div style="flex:1;overflow-y:auto;min-height:0;">
        <table class="items-table art-table">
            <thead><tr>
                ${thead('tipo','Descripción')}
                ${thead('id','Código')}
                ${thead('proveedor','Proveedor')}
                ${thead('gramaje','Gramaje')}
                ${thead('totalKilos','Kg totales','right')}
                ${thead('palets','Palets est.','right')}
                <th class="text-right">Kg/palet</th>
                <th class="text-center">Pasillos</th>
            </tr></thead>
            <tbody>`;

    rows.forEach(r => {
        const kgPP     = getKgPerPalet(r.id);
        const isCustom = !!(articleConfig[r.id] && articleConfig[r.id].kgPerPalet > 0);
        const aislesHtml = r.aisles.slice(0,5).map(a => `<span class="dd-aisle-tag" style="cursor:pointer;" data-aisle="${a}" title="Ir al pasillo ${a}">P${a}</span>`).join('');
        const moreAisles = r.aisles.length > 5 ? `<span style="color:var(--text-muted);font-size:10px;">+${r.aisles.length-5}</span>` : '';

        html += `<tr class="art-row">
            <td style="font-size:12px;line-height:1.35;">${esc(r.tipo)}</td>
            <td class="ref-code">${esc(r.id)}</td>
            <td class="mono-sm c-muted">${esc(r.proveedor)}</td>
            <td class="mono-sm c-muted">${esc(r.gramaje)}</td>
            <td class="text-right mono-sm">${fmtNum(Math.round(r.totalKilos))}</td>
            <td class="text-right mono-sm">${r.palets.toFixed(1)}</td>
            <td class="text-right">
                <div class="kgpal-cell">
                    <input type="number" min="1" max="99999"
                           class="kgpal-input ${isCustom?'kgpal-custom':''}"
                           data-ref="${esc(r.id)}"
                           value="${isCustom ? kgPP : ''}"
                           placeholder="600"
                           onclick="event.stopPropagation()">
                </div>
            </td>
            <td class="text-center">
                <div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;">${aislesHtml}${moreAisles}</div>
            </td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    // Delegation for clicks (sort headers, aisle tags, import button)
    if (!container._delegated) {
        container.addEventListener('click', e => {
            const th = e.target.closest('.art-th[data-sort]');
            if (th) { artSort(th.dataset.sort); return; }
            const tag = e.target.closest('.dd-aisle-tag[data-aisle]');
            if (tag) { e.stopPropagation(); goToAisle(tag.dataset.aisle); return; }
            const imp = e.target.closest('[data-action="import"]');
            if (imp) { importArticleConfig(); return; }
        });
        container.addEventListener('change', e => {
            const inp = e.target.closest('.kgpal-input[data-ref]');
            if (inp) saveKgPal(inp.dataset.ref, inp.value);
        });
        container._delegated = true;
    }

    // Search en artículos
    const artInp = document.getElementById('art-search-input');
    if (artInp) {
        artInp.addEventListener('input', e => {
            articleSearch = e.target.value;
            renderArticles();
        });
        artInp.focus();
        artInp.setSelectionRange(artInp.value.length, artInp.value.length);
    }

    // File input para Excel
    const fileInp = document.getElementById('art-excel-input');
    if (fileInp) fileInp.addEventListener('change', handleExcelImport);
}

function artSort(col) {
    if (articleSortCol === col) articleSortDir *= -1;
    else { articleSortCol = col; articleSortDir = -1; }
    renderArticles();
}

function saveKgPal(refId, val) {
    const n = parseFloat(val);
    if (n > 0) {
        getArticleCfg(refId).kgPerPalet = n;
        addLog('edit', `Kg/palet actualizado: ${refId} → ${n}`, null);
    } else {
        delete articleConfig[refId];
    }
    saveArticleConfig();
    invalidateCatalog();
    renderWarehouse();
    // Actualizar el input visualmente
    const inp = document.querySelector(`.kgpal-input[data-ref="${refId}"]`);
    if (inp) inp.classList.toggle('kgpal-custom', n > 0);
};

// ─── IMPORTAR EXCEL ───────────────────────────────────────────────────────────
function importArticleConfig() {
    document.getElementById('art-excel-input').click();
};

async function handleExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Necesitamos SheetJS — cargarlo dinámicamente si no está
    if (!window.XLSX) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    const data   = await file.arrayBuffer();
    const wb     = XLSX.read(data, { type: 'array' });
    const ws     = wb.Sheets[wb.SheetNames[0]];

    // Leer ignorando las cabeceras sucias, buscando la primera fila que parece tener datos (skiprows=5 suele ser estándar)
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!rawRows || rawRows.length < 5) { alert('El Excel parece vacío o no tiene el formato correcto.'); return; }
    
    // Asumir que los headers reales están alrededor de la fila 5 o 6
    let headerRowIndex = 0;
    for(let i=0; i<10; i++) {
        if(rawRows[i] && rawRows[i].some(v => String(v).toLowerCase().includes('codigo'))) {
            headerRowIndex = i;
            break;
        }
    }

    const headers = rawRows[headerRowIndex].map(h => String(h||'').toLowerCase().replace(/[\s_\/]/g, ''));
    
    // Encontrar índices de columnas necesarias
    const idxCod = headers.findIndex(h => h.includes('codigo') || h.includes('referencia') || h==='ref');
    const idxKg  = headers.findIndex(h => h.includes('kgpal') || h.includes('kgporpalet') || h.includes('pesopal') || h==='kgpalet' || h==='kg/palet');
    
    // Si no encuentra la columna kg, avisamos (la del código es crítica)
    if (idxCod === -1) { alert('No encuentro columna de código/referencia.'); return; }
    if (idxKg === -1)  { alert('No encuentro columna de Kg/palet. Asegúrate de que la columna se llame "kg/palet".'); return; }

    let updated = 0, skipped = 0;
    
    // Procesar los datos saltando hasta después de la fila de headers
    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        
        const rawCod = String(row[idxCod] || '').trim();
        // Ignorar filas basura
        if (!rawCod || rawCod.toLowerCase().includes('codigo') || rawCod.toLowerCase().includes('total listado') || rawCod.includes('e-') || rawCod === '---Stock---') {
            continue;
        }
        
        const refId = rawCod.replace(/\s+/g, '');
        const kgRaw = String(row[idxKg] || '').replace(',', '.');
        const kg = parseFloat(kgRaw);
        
        if (!refId || isNaN(kg) || kg <= 0) {
            skipped++; 
            continue;
        }
        
        getArticleCfg(refId).kgPerPalet = kg;
        updated++;
    }

    saveArticleConfig();
    invalidateCatalog();
    renderWarehouse();
    renderArticles();
    addLog('sync', `Excel importado: ${updated} kg/palet actualizados, ${skipped} filas ignoradas`);
    alert(`✅ Importación de Kg/Palet completada:\n• ${updated} referencias actualizadas\n• ${skipped} filas ignoradas (sin código o kg vacío)`);
    e.target.value = ''; // reset input
}

// ─── IMPORTAR INVENTARIO COMPLETO DESDE EXCEL "SUCIO" ─────────────────────────
async function handleInventoryExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Cargar SheetJS si no está
    if (!window.XLSX) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (!rawRows || rawRows.length < 6) { alert('El Excel parece vacío o no tiene el formato correcto.'); return; }

    // Buscar la fila de cabeceras (donde aparece "Codigo")
    let headerRowIndex = 0;
    for (let i = 0; i < 10; i++) {
        if (rawRows[i] && rawRows[i].some(v => String(v).toLowerCase().includes('codigo'))) {
            headerRowIndex = i;
            break;
        }
    }

    // Columnas: 0=Codigo, 1=Descripcion, 3=Proveedor/Desc, 6=P.Costo(ubicacion), 9=Stock
    const COL_COD = 0, COL_DESC = 1, COL_PROV = 3, COL_UBI = 6, COL_STOCK = 9;

    const newAislesData = {};
    let imported = 0, ignored = 0;

    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const codigo = String(row[COL_COD] || '').trim();
        if (!codigo || codigo.toLowerCase().includes('codigo') || codigo.toLowerCase().includes('total listado') || codigo === 'nan') continue;

        const ubiRaw = String(row[COL_UBI] || '').trim().toUpperCase();
        if (!ubiRaw || ubiRaw === 'NAN' || ubiRaw === 'UNDEFINED') { ignored++; continue; }

        // Determinar ID de ubicación
        let aisleId = null;
        if (ubiRaw.includes('TALLER'))      aisleId = 'TALLER';
        else if (ubiRaw.includes('MONGE'))   aisleId = 'MONGE';
        else if (ubiRaw.includes('DIGITAL')) aisleId = 'DIGITAL';
        else {
            const m = ubiRaw.match(/^C(\d+)/);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num >= 1 && num <= 99) aisleId = String(num).padStart(2, '0');
            }
        }

        if (!aisleId) { ignored++; continue; }

        if (!newAislesData[aisleId]) newAislesData[aisleId] = [];

        const desc = String(row[COL_DESC] || '').trim();
        const prov = String(row[COL_PROV] || '').trim();
        let hojas = 0;
        try { hojas = parseInt(parseFloat(String(row[COL_STOCK] || '0')), 10); } catch(e) {}
        if (isNaN(hojas)) hojas = 0;

        const gramaje = extractGramaje(codigo);
        const tipo = (prov && prov.length > 5 && prov !== 'nan') ? prov : ((desc && desc !== 'nan') ? desc : 'Papel');

        newAislesData[aisleId].push({
            id: codigo,
            tipo: tipo.substring(0, 80),
            gramaje: gramaje,
            proveedor: (prov && prov !== 'nan') ? prov.split(' ')[0] : '-',
            kilos: 0,
            hojas: hojas,
            fecha_entrada: 'Sincronizado Excel Web'
        });
        imported++;
    }

    if (imported === 0) {
        alert('No se han encontrado artículos válidos en el Excel. Revisa que el formato sea correcto.');
        e.target.value = '';
        return;
    }

    // Actualizar allAislesData con los nuevos items
    Object.keys(newAislesData).forEach(aisleId => {
        if (allAislesData[aisleId]) {
            allAislesData[aisleId].items = newAislesData[aisleId];
        }
    });

    // Si hay Firestore, sincronizar
    if (window.firebaseDb) {
        const db = window.firebaseDb;
        try {
            await Promise.all(Object.keys(newAislesData).map(id =>
                window.firebaseSetDoc(window.firebaseDoc(db, 'almacen', id), { items: newAislesData[id] })
            ));
        } catch(err) { console.error('Error sincronizando con Firestore:', err); }
    }

    invalidateCatalog();
    renderWarehouse();
    addLog('sync', `Inventario importado: ${imported} artículos en ${Object.keys(newAislesData).length} pasillos`);
    alert(`✅ Inventario importado correctamente:\n• ${imported} artículos importados\n• ${Object.keys(newAislesData).length} pasillos actualizados\n• ${ignored} filas ignoradas`);
    e.target.value = '';
}

// ─── HISTORIAL ────────────────────────────────────────────────────────────────
function addLog(type, desc, aisleId) {
    const colors = { system:'#6366f1', update:'#f59e0b', sync:'#22c55e', error:'#ef4444', edit:'#a78bfa', disable:'#6b7280', enable:'#22c55e' };
    activityLog.unshift({ type, desc, aisleId: aisleId||null, time: new Date(), color: colors[type]||'#6b7280' });
    if (activityLog.length > 60) activityLog.pop();
}

function renderHistory() {
    const el = document.getElementById('history-list');
    if (!activityLog.length) { el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:12px;font-family:var(--font-mono);">Sin actividad</div>`; return; }
    el.innerHTML = activityLog.map(log => {
        const t  = log.time;
        const ts = `${t.toLocaleDateString('es-ES')} ${t.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`;
        const badge = log.aisleId ? `<span class="history-badge" style="background:${log.color}22;color:${log.color};">P${log.aisleId}</span>` : '';
        return `<div class="history-row"><div class="history-dot" style="background:${log.color};"></div><span class="history-time">${ts}</span><span class="history-desc">${log.desc}</span>${badge}</div>`;
    }).join('');
}

// ─── FIRESTORE ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await initMockData();
    renderWarehouse();
    setupSearch();
    setupNavigation();
    document.getElementById('edit-modal').addEventListener('click', () => closeEditModal());

    // Wiring: Subir Inventario Excel
    document.getElementById('upload-inventory-btn').addEventListener('click', () => {
        document.getElementById('inventory-excel-input').click();
    });
    document.getElementById('inventory-excel-input').addEventListener('change', handleInventoryExcelImport);

    if (window.firebaseDb) {
        const statusEl = document.getElementById('sidebar-status');
        statusEl.textContent = 'Conectando...';
        const db = window.firebaseDb, colRef = window.firebaseCollection(db, 'almacen');

        let isFirstLoad = true;
        window.firebaseOnSnapshot(colRef, snapshot => {
            if (snapshot.empty && isFirstLoad) {
                statusEl.textContent = 'Volcando datos...';
                Promise.all(Object.keys(allAislesData).map(id =>
                    window.firebaseSetDoc(window.firebaseDoc(db,'almacen',id), { items: allAislesData[id].items||[] })
                )).then(()=>addLog('sync','Datos iniciales volcados')).catch(console.error);
            } else if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    const id = doc.id, data = doc.data();
                    if (allAislesData[id]) {
                        const prev = JSON.stringify(allAislesData[id].items);
                        const next = Array.isArray(data.items) ? data.items : [];
                        if (!isFirstLoad && prev !== JSON.stringify(next)) addLog('update',`P${id} actualizado`,id);
                        allAislesData[id].items = next;
                    }
                });
                invalidateCatalog();
                statusEl.textContent = 'En vivo (Firestore)';
                renderWarehouse();
                const active = document.querySelector('.aisle-unit.active');
                if (active) { const id=active.getAttribute('data-id'); if(allAislesData[id]) showInspector(allAislesData[id]); }
            }
            isFirstLoad = false;
        }, err => { addLog('error',err.message); statusEl.textContent='Error (local)'; });
    }
});