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
        { id: 'nave2-izq', name: 'N2 Izquierdo (81-76)', start: 81, end: 76, alignRight: true }
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
        const kg = Math.max(0, it.kilos || 0);
        return s + kg;
    }, 0);
}

// Palets reales usando kg/palet de la config de artículo
function calcPalets(items) {
    if (!items || !items.length) return 0;
    return items.reduce((s, it) => {
        const kg = Math.max(0, it.kilos || 0);
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

// Extraer dimensiones del papel desde la descripción (ej: "75X105")
function parsePaperDimensions(desc) {
    if (!desc) return null;
    const m = desc.match(/(\d+(?:[.,]\d+)?)\s?[xX*]\s?(\d+(?:[.,]\d+)?)/);
    if (m) {
        return {
            w: parseFloat(m[1].replace(',', '.')),
            h: parseFloat(m[2].replace(',', '.'))
        };
    }
    return null;
}
// Construye un mapa refId → { id, tipo, gramaje, proveedor, totalKilos, palets, aisles[] }
function buildCatalog() {
    if (!_catalogDirty && _catalogCache) return _catalogCache;
    const cat = {};
    Object.values(allAislesData).forEach(aisle => {
        (aisle.items || []).forEach(it => {
            // Determinar gramaje: primero intentar del código, luego del dato original
            let gramaje = it.gramaje || '';
            if (!gramaje || gramaje === '-') gramaje = extractGramaje(it.id || '');

            if (!cat[it.id]) {
                cat[it.id] = {
                    id: it.id, tipo: it.tipo || '', gramaje: gramaje,
                    proveedor: it.proveedor || '', totalKilos: 0, totalHojas: 0,
                    palets: 0, aisles: {} // aisleId -> { hojas, kilos }
                };
            }
            cat[it.id].totalKilos += Math.max(0, it.kilos || 0);
            cat[it.id].totalHojas += Math.max(0, it.hojas || 0);
            cat[it.id].palets     += Math.max(0, it.kilos || 0) / getKgPerPalet(it.id);
            
            if (!cat[it.id].aisles[aisle.id]) cat[it.id].aisles[aisle.id] = { hojas: 0, kilos: 0 };
            cat[it.id].aisles[aisle.id].hojas += Math.max(0, it.hojas || 0);
            cat[it.id].aisles[aisle.id].kilos += Math.max(0, it.kilos || 0);
        });
    });
    // Convertir map de aisles a array ordenado
    Object.values(cat).forEach(a => {
        a.aisleList = Object.entries(a.aisles).map(([id, info]) => ({ id, ...info })).sort((x, y) => x.id.localeCompare(y.id));
        // Para compatibilidad con otros sitios que usen .aisles como array
        a.aisles = a.aisleList.map(x => x.id);
    });
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

    // Eventos sidebar search
    const sInput = document.getElementById('search-input');
    const sClear = document.getElementById('search-clear');
    if (sInput && sClear) {
        sInput.addEventListener('input', () => {
            sClear.style.display = sInput.value ? 'flex' : 'none';
        });
        sClear.addEventListener('click', () => {
            sInput.value = '';
            sClear.style.display = 'none';
            sInput.focus();
            document.getElementById('search-dropdown').style.display = 'none';
        });
    }

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
                        <div class="racks-container ${block.isExternal ? 'single-col' : ''} ${block.alignRight ? 'align-right' : ''}">`;

            block.aisles.forEach(aisle => {
                const disabled = isDisabled(aisle);
                const cap = getCapacity(aisle);
                const pal = parseFloat(calcPalets(aisle.items).toFixed(1));
                if (!disabled) { totalFilled += pal; totalCap += cap; }
                const occ  = cap > 0 ? (pal / cap) * 100 : 0;
                const heat = disabled ? 'disabled' : getHeatmapClass(occ);
                html += `
                    <div class="rack aisle-unit ${heat}" data-id="${aisle.id}"
                         title="${disabled ? '⛔ Anulado' : `P${aisle.id} · ${pal} pal. · ${Math.round(occ)}% · ${aisle.items.length} refs`}">
                        ${disabled ? '<i class="ri-forbid-line" style="font-size:10px;color:#4b5563;z-index:1;"></i>' : ''}
                        <span class="rack-id" style="${disabled?'color:#4b5563;':''}">${aisle.id}</span>
                        <span class="aisle-badge" style="${disabled?'color:#374151;':''}">${disabled ? 'anulado' : pal+' pal.'}</span>
                        ${!disabled ? `<span class="aisle-refs">${aisle.items.length} ref${aisle.items.length !== 1 ? 's' : ''}</span>` : ''}
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
    const cfg = getAisleCfg(aisleData.id);
    const cap = getCapacity(aisleData);
    const pal = parseFloat(calcPalets(aisleData.items).toFixed(1));
    const occ = cap > 0 ? (pal / cap) * 100 : 0;

    const col = disabled ? '#6b7280' : getHeatmapColorHex(occ);

    // MODELO VOLUMÉTRICO: BASES EN SUELO Y ALTURAS
    // 1. Calcular bases necesarias (pilas) basado en altura acumulada artículos + madera (15cm)
    // 2. Comprobar contra dimensiones configuradas del pasillo
    let basesNeeded = 0;
    let totalVolM3 = 0;
    
    // Agrupar items por ref para el listado interior y cálculo volumétrico
    const grouped = {};
    (aisleData.items || []).forEach(it => {
        if (!grouped[it.id]) grouped[it.id] = { ...it, totalKilos: 0, totalHojas: 0 };
        grouped[it.id].totalKilos += Math.max(0, it.kilos || 0);
        grouped[it.id].totalHojas += Math.max(0, it.hojas || 0);
    });
    // FILTRO: Solo mostrar artículos con stock real en este pasillo
    const rows = Object.values(grouped).filter(r => r.totalKilos > 0 || r.totalHojas > 0).sort((a, b) => b.totalKilos - a.totalKilos);

    const aH = cfg.h || 200; // Altura pasillo estimada 2m si no hay
    const aL = cfg.l || 0;
    const aW = cfg.w || 0;
    
    let totalLinearUsed = 0;

    rows.forEach(r => {
        const d = parsePaperDimensions(r.tipo);
        const g = parseInt(r.gramaje) || 0;
        const numPal = Math.ceil(r.totalKilos / getKgPerPalet(r.id));
        
        // Determinar longitud necesaria para ESTE palet/referencia
        let refLength = 110; // default 1.1m
        if (d) refLength = Math.max(d.w, d.h) + 10; // Dimensión mayor + 10cm margen

        if (d && g > 0) {
            // Volume = Area * (Gram/1e6) * bulk * Hojas
            const vol = ( (d.w * d.h) / 10000 ) * (g / 1000000) * 1.2 * r.totalHojas;
            totalVolM3 += vol;
            
            // Altura (cm): (Hojas * gram / 10000 * 1.2) + (numPalets * 15cm madera)
            const paperH = r.totalHojas * (g / 10000) * 1.2;
            const stackH = paperH + (numPal * 15);
            
            // Bases necesarias para esta referencia (stacking vertical limitado por aH)
            const basesForThisRef = Math.ceil(stackH / aH);
            basesNeeded += basesForThisRef;
            totalLinearUsed += basesForThisRef * refLength;
        } else {
            // Sin dimensiones: 1 palet = 1 base de 110cm
            basesNeeded += numPal;
            totalLinearUsed += numPal * refLength;
        }
    });

    const aisleVolM3 = (aL && aW && aH) ? (aL * aW * aH) / 1000000 : 0;
    const volOcc    = (aL > 0) ? (totalLinearUsed / aL) * 100 : (aisleVolM3 > 0 ? (totalVolM3 / aisleVolM3) * 100 : 0);

    const statusBadge = disabled
        ? `<span class="insp-badge" style="background:#374151;color:#9ca3af;">⛔ Pasillo Anulado — no cuenta en métricas</span>`
        : `<span class="insp-badge" style="background:${col}22;color:${col};">${Math.round(occ)}% · ${pal} / ${cap} pal.</span>`;

    const volBadge = (aL > 0)
        ? `<span class="insp-badge" style="background:#0ea5e922;color:#0ea5e9;margin-left:5px;">${Math.round(volOcc)}% Lineal (${(totalLinearUsed/100).toFixed(1)}m / ${(aL/100).toFixed(1)}m)</span>`
        : (totalVolM3 > 0 ? `<span class="insp-badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted);margin-left:5px;">${totalVolM3.toFixed(2)} m³</span>` : '');

    let html = `
        <div class="inspector-header">
            <div>
                <h3 class="insp-title">Pasillo ${aisleData.id}</h3>
                <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
                    ${statusBadge}
                    ${volBadge}
                </div>
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

    // Agrupar items por ref para mostrar en el modal
    const grouped = {};
    (aisle.items || []).forEach(it => {
        if (!grouped[it.id]) grouped[it.id] = { ...it, totalKilos: 0 };
        grouped[it.id].totalKilos += Math.max(0, it.kilos || 0);
    });
    const rows = Object.values(grouped).sort((a, b) => b.totalKilos - a.totalKilos);

    let articlesHtml = rows.length === 0
        ? `<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Sin artículos en este pasillo</div>`
        : rows.map(g => {
            const kgPP = getKgPerPalet(g.id);
            const isCustom = !!(articleConfig[g.id] && articleConfig[g.id].kgPerPalet > 0);
            return `<div class="edit-article-row">
                <div class="edit-article-info">
                    <span class="edit-article-code">${esc(g.id)}</span>
                    <span class="edit-article-desc">${esc(g.tipo)}</span>
                </div>
                <div class="edit-article-kg">
                    <label style="font-size:10px;color:var(--text-muted);">Kg/pal</label>
                    <input type="number" class="edit-input kgpal-input" data-ref="${esc(g.id)}"
                        min="1" max="9999" value="${kgPP}"
                        style="${isCustom?'border-color:var(--accent);color:var(--accent);':''}">
                </div>
            </div>`;
        }).join('');

    const modal = document.getElementById('edit-modal');
    modal.innerHTML = `
        <div class="edit-modal-box edit-modal-wide">
            <div class="edit-modal-header">
                <h3><i class="ri-settings-3-line"></i> Pasillo ${id}</h3>
                <button class="insp-action-btn btn-close" data-action="close"><i class="ri-close-line"></i></button>
            </div>
            <div class="edit-modal-body">
                <div class="edit-section">
                    <label class="edit-label">Capacidad máxima (palets)</label>
                    <input type="number" id="edit-capacity" min="1" max="9999" class="edit-input" value="${cap}" placeholder="${aisle.capacity}">
                    <span class="edit-hint">Por defecto: ${aisle.capacity} palets</span>
                </div>
                <div class="edit-section">
                    <label class="edit-label">Dimensiones Pasillo (Largo x Ancho x Alto cm)</label>
                    <div style="display:flex;gap:10px;">
                        <input type="number" id="edit-dim-l" class="edit-input" placeholder="Largo" value="${cfg.l||''}" style="flex:1;">
                        <input type="number" id="edit-dim-w" class="edit-input" placeholder="Ancho" value="${cfg.w||''}" style="flex:1;">
                        <input type="number" id="edit-dim-h" class="edit-input" placeholder="Alto" value="${cfg.h||''}" style="flex:1;">
                    </div>
                </div>
                <div class="edit-section">
                    <label class="edit-label">Artículos en el pasillo <span style="color:var(--text-muted);font-weight:400;font-size:11px;">(edita Kg/palet de cada uno)</span></label>
                    <div class="edit-articles-list">${articlesHtml}</div>
                </div>
            </div>
            <div class="edit-modal-footer">
                <button class="btn-secondary" data-action="reset"><i class="ri-refresh-line"></i> Restaurar</button>
                <button class="btn-primary" data-action="save"><i class="ri-save-line"></i> Guardar</button>
            </div>
        </div>`;
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
    cfg.l = parseFloat(document.getElementById('edit-dim-l').value) || 0;
    cfg.w = parseFloat(document.getElementById('edit-dim-w').value) || 0;
    cfg.h = parseFloat(document.getElementById('edit-dim-h').value) || 0;
    saveAisleConfig();

    // Guardar kg/palet de cada artículo editado
    let updatedArticles = 0;
    document.querySelectorAll('#edit-modal .kgpal-input').forEach(inp => {
        const refId = inp.getAttribute('data-ref');
        const kg = parseFloat(inp.value);
        if (refId && kg > 0) { getArticleCfg(refId).kgPerPalet = kg; updatedArticles++; }
    });
    if (updatedArticles > 0) saveArticleConfig();

    addLog('edit', `P${id} — capacidad ${v}, ${updatedArticles} kg/pal actualizados`, id);
    closeEditModal();
    invalidateCatalog();
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
        const kg    = items.reduce((s, it) => s + Math.max(0, it.kilos || 0), 0);
        const hojas = items.reduce((s, it) => s + Math.max(0, it.hojas || 0), 0);
        if (kg === 0 && hojas === 0) return null; // FILTRO: Ocultar si no hay stock real
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
            ['map','metrics','history','articles','config'].forEach(v => {
                const el = document.getElementById(`view-${v}`);
                if (el) el.style.display = v === view ? 'flex' : 'none';
            });
            if (view === 'metrics')  renderMetrics();
            if (view === 'history')  renderHistory();
            if (view === 'articles') renderArticles();
            if (view === 'config')   renderConfigView();
            closeInspector();
        });
    });
    document.getElementById('view-map').style.display      = 'flex';
    document.getElementById('view-metrics').style.display  = 'none';
    document.getElementById('view-history').style.display  = 'none';
    document.getElementById('view-articles').style.display = 'none';
    document.getElementById('view-config').style.display   = 'none';
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

    // 5. Resumen por Área
    const AREA_DEFS = [
        { label: 'N1 Derecho',    range: [1,17],   color: '#6366f1' },
        { label: 'N1 Izquierdo',  range: [43,55],  color: '#8b5cf6' },
        { label: 'N2 Derecho',    range: [18,42],  color: '#0ea5e9' },
        { label: 'N2 Central',    range: [63,75],  color: '#06b6d4' },
        { label: 'N2 Izquierdo',  range: [76,81],  color: '#14b8a6' },
        { label: 'Digital',       extIds: ['DIGITAL'], color: '#f59e0b' },
        { label: 'Taller',        extIds: ['TALLER'],  color: '#ef4444' },
    ];
    const AREAS = [
        // Primero el total propio
        { label: '🏭 Almacén ZGZ', all: true, color: '#22d3ee', bold: true },
        // Luego desglose
        ...AREA_DEFS,
        // Externo separado
        { label: '📦 Monge (ext.)', extIds: ['MONGE'], color: '#f97316', external: true },
    ];

    const areasEl = document.getElementById('metrics-areas');
    if (areasEl) {
        const areaStats = AREAS.map(area => {
            let kg = 0, pal = 0, refs = 0;
            // all:true → sumar todos los AREA_DEFS (N1+N2+Digital+Taller, sin Monge)
            const defsToSum = area.all ? AREA_DEFS : [area];
            defsToSum.forEach(def => {
                if (def.range) {
                    const [rStart, rEnd] = [Math.min(...def.range), Math.max(...def.range)];
                    for (let n = rStart; n <= rEnd; n++) {
                        const a = allAislesData[String(n).padStart(2,'0')];
                        if (a && !isDisabled(a)) { kg += calcTotalKilos(a.items); pal += calcPalets(a.items); refs += (a.items?.length||0); }
                    }
                }
                (def.extIds || []).forEach(extId => {
                    const a = allAislesData[extId];
                    if (a && !isDisabled(a)) { kg += calcTotalKilos(a.items); pal += calcPalets(a.items); refs += (a.items?.length||0); }
                });
            });
            return { ...area, kg, pal: Math.round(pal), refs };
        });

        areasEl.innerHTML = areaStats.map(a => {
            if (a.external) {
                return `
                    <div class="area-external-divider"><span>Almacenes externos</span></div>
                    <div class="area-card area-card-total area-card-external" style="border-color:${a.color}88;">
                        <div class="area-card-label" style="color:${a.color};font-size:12px;font-weight:800;">${a.label}</div>
                        <div class="area-card-stats">
                            <div><span class="area-stat-val">${fmtNum(Math.round(a.kg))}</span><span class="area-stat-lbl">kg</span></div>
                            <div><span class="area-stat-val">${fmtNum(a.pal)}</span><span class="area-stat-lbl">pal.</span></div>
                            <div><span class="area-stat-val">${fmtNum(a.refs)}</span><span class="area-stat-lbl">refs</span></div>
                        </div>
                    </div>`;
            }
            return `
            <div class="area-card${a.bold ? ' area-card-total' : ''}" style="border-color:${a.color}${a.bold ? '88' : '33'};">
                <div class="area-card-label" style="color:${a.color};${a.bold ? 'font-size:12px;font-weight:800;' : ''}">${a.label}</div>
                <div class="area-card-stats">
                    <div><span class="area-stat-val">${fmtNum(Math.round(a.kg))}</span><span class="area-stat-lbl">kg</span></div>
                    <div><span class="area-stat-val">${fmtNum(a.pal)}</span><span class="area-stat-lbl">pal.</span></div>
                    <div><span class="area-stat-val">${fmtNum(a.refs)}</span><span class="area-stat-lbl">refs</span></div>
                </div>
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
    let html = `
        <div class="canvas-header" style="flex-shrink:0;">
            <h2>Artículos <span style="font-size:12px;color:var(--text-muted);font-weight:400;">(${rows.length})</span></h2>
            <div style="display:flex;gap:8px;align-items:center;">
                <div class="art-search-wrap">
                    <i class="ri-search-line" style="color:var(--text-muted);font-size:13px;"></i>
                    <input type="text" id="art-search-input" class="art-search-input" placeholder="Filtrar artículos..." value="${articleSearch}">
                    <button id="art-search-clear" class="search-clear-btn" style="${articleSearch?'display:flex':'display:none'}" title="Limpiar">
                        <i class="ri-close-line"></i>
                    </button>
                </div>
                <button class="btn-secondary" style="font-size:11px;padding:5px 10px;" data-action="import" title="Importar kg/palet desde Excel">
                    <i class="ri-upload-2-line"></i> Importar Excel
                </button>
            </div>
        </div>
        <div style="flex:1;overflow-y:auto;min-height:0;">
        <table class="items-table art-table">
            <thead><tr>
                ${thead('tipo','Descripción')}
                ${thead('id','Código')}
                ${thead('gramaje','Gramaje')}
                ${thead('totalHojas', 'Hojas', 'right')}
                ${thead('totalKilos','Kg totales','right')}
                ${thead('palets','Pal. est.','right')}
                <th class="text-right">Kg/pal</th>
                <th class="text-center">Pasillos</th>
                <th class="text-center">Acción</th>
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
            <td class="mono-sm c-muted">${esc(r.gramaje)}</td>
            <td class="text-right mono-sm">${fmtNum(r.totalHojas)}</td>
            <td class="text-right mono-sm">${fmtNum(Math.round(r.totalKilos))}</td>
            <td class="text-right mono-sm" style="color:var(--accent);font-weight:700;">${r.palets.toFixed(1)}</td>
            <td class="text-right mono-sm">
                <span style="${isCustom?'color:var(--accent);font-weight:700;':'color:#6b7280;'}">${fmtNum(kgPP)}</span>
            </td>
            <td class="text-center">
                <div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;">${aislesHtml}${moreAisles}</div>
            </td>
            <td class="text-center">
                <button class="btn-view-detail" data-ref="${r.id}">Ver</button>
            </td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    // File input para Excel
    if (!document.getElementById('art-excel-input')) {
        const fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.id = 'art-excel-input';
        fileInp.accept = '.xls,.xlsx';
        fileInp.style.display = 'none';
        fileInp.addEventListener('change', handleExcelImport);
        document.body.appendChild(fileInp);
    }

    // Eventos
    const artInp = container.querySelector('#art-search-input');
    if (artInp) {
        artInp.addEventListener('input', e => {
            articleSearch = e.target.value;
            renderArticles();
        });
        artInp.focus();
        artInp.setSelectionRange(artInp.value.length, artInp.value.length);
    }
    container.querySelector('#art-search-clear')?.addEventListener('click', () => {
        articleSearch = ''; renderArticles();
    });
    container.querySelectorAll('.art-th').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (articleSortCol === col) articleSortDir *= -1;
            else { articleSortCol = col; articleSortDir = -1; }
            renderArticles();
        });
    });
    container.querySelectorAll('.dd-aisle-tag').forEach(tag => {
        tag.addEventListener('click', () => goToAisle(tag.getAttribute('data-aisle')));
    });
    container.querySelectorAll('.btn-view-detail').forEach(btn => {
        btn.addEventListener('click', () => showArticleDetail(btn.getAttribute('data-ref')));
    });
    container.querySelector('[data-action="import"]')?.addEventListener('click', () => document.getElementById('art-excel-input').click());
}

// ─── FICHA DE ARTÍCULO ────────────────────────────────────────────────────────
function showArticleDetail(refId) {
    const cat = buildCatalog();
    const art = cat[refId];
    if (!art) return;

    const dims = parsePaperDimensions(art.tipo);
    const gram = parseInt(art.gramaje) || 0;
    let volInfo = '';

    if (dims && gram > 0) {
        // Volumen estimado: Area * (Gramaje/1e6) * bulk * Hojas
        // Bulk medio papel = 1.2 cm3/g = 0.0012 m3/kg
        const areaM2 = (dims.w * dims.h) / 10000;
        const volumeM3 = (areaM2 * (gram / 1000000) * 1.2 * art.totalHojas).toFixed(3);
        volInfo = `
            <div class="kpi-card" style="border-left:3px solid var(--accent);">
                <div class="kpi-label">Volumen Estimado</div>
                <div class="kpi-value">${volumeM3} <span style="font-size:12px;">m³</span></div>
                <div class="kpi-trend">Basado en ${dims.w}x${dims.h} mm</div>
            </div>`;
    }

    const container = document.getElementById('view-articles');
    container.innerHTML = `
        <div class="canvas-header">
            <div style="display:flex;align-items:center;gap:15px;">
                <button class="btn-secondary" id="detail-back" style="padding:5px 10px;"><i class="ri-arrow-left-line"></i> Volver</button>
                <h2>Ficha de Artículo</h2>
            </div>
        </div>
        <div style="padding:20px; overflow-y:auto; flex:1;">
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px;">
                <div class="glass-panel" style="padding:24px; background:white;">
                    <div style="color:var(--text-muted); font-size:11px; margin-bottom:8px; text-transform:uppercase; letter-spacing:1px;">REFERENCIA</div>
                    <h1 style="margin:0 0 15px 0; font-family:Syne; font-size:32px; letter-spacing:-0.5px; color:var(--text-main);">${esc(art.id)}</h1>
                    <p style="font-size:18px; line-height:1.6; color:var(--text-main); font-weight:500;">${esc(art.tipo)}</p>
                    
                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; margin-top:35px;">
                        <div class="kpi-card">
                            <div class="kpi-label">Stock Hojas</div>
                            <div class="kpi-value">${fmtNum(art.totalHojas)}</div>
                            <div class="kpi-trend">Disponibles</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Peso Total</div>
                            <div class="kpi-value">${fmtNum(Math.round(art.totalKilos))} <span style="font-size:12px;">kg</span></div>
                            <div class="kpi-trend">Peso real</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Palets Est.</div>
                            <div class="kpi-value" style="color:var(--accent);">${art.palets.toFixed(1)}</div>
                            <div class="kpi-trend">Espacio ocupado</div>
                        </div>
                        ${volInfo}
                    </div>
                </div>
                <div class="glass-panel" style="padding:24px; background:white;">
                    <h3 style="margin-top:0; font-family:Syne;">Ubicaciones</h3>
                    <div style="display:flex; flex-direction:column; gap:10px; margin-top:15px;">
                        ${art.aisleList.filter(a => a.hojas > 0 || a.kilos > 0).map(a => `
                            <div class="dd-aisle-tag" style="padding:12px; font-size:13px; cursor:pointer;" data-aisle="${a.id}">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <span>Pasillo ${a.id}</span>
                                    <span style="font-weight:700; color:var(--accent);">${fmtNum(a.hojas)} <span style="font-size:10px; font-weight:400; color:var(--text-muted);">hojas</span></span>
                                </div>
                                <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${fmtNum(Math.round(a.kilos))} kg</div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top:35px; padding-top:20px; border-top:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                            <span style="color:var(--text-muted); font-size:12px;">Proveedor</span>
                            <span style="font-size:12px;">${esc(art.proveedor)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--text-muted); font-size:12px;">Gramaje</span>
                            <span style="font-size:12px;">${esc(art.gramaje)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    container.querySelector('#detail-back').addEventListener('click', renderArticles);
    container.querySelectorAll('.dd-aisle-tag').forEach(tag => {
        tag.addEventListener('click', () => goToAisle(tag.getAttribute('data-aisle')));
    });
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

    if (!rawRows || rawRows.length < 6) {
        alert('El Excel parece vacío o no tiene el formato correcto.');
        return;
    }

    // Buscar fila de cabeceras
    let hdr = 0;
    for (let i = 0; i < 10; i++) {
        if (rawRows[i] && rawRows[i].some(v => String(v).toLowerCase().includes('codigo'))) {
            hdr = i; break;
        }
    }

    // Índices fijos del Excel in2:
    // [0]=Codigo  [3]=Proveedor  [6]=P.Costo(ubicacion)
    // [9]=J=Kilos   [12]=M=Hojas(pliegos)
    const COL_COD   = 0;
    const COL_PROV  = 3;
    const COL_UBI   = 6;
    const COL_KG    = 9;   // J = kilos
    const COL_HOJAS = 12;  // M = hojas/pliegos

    function getAisleId(ubiRaw) {
        const u = String(ubiRaw || '').trim().toUpperCase();
        if (!u || u === 'NAN') return null;
        if (u.includes('TALLER'))  return 'TALLER';
        if (u.includes('MONGE'))   return 'MONGE';
        if (u.includes('DIGITAL')) return 'DIGITAL';
        const m = u.match(/^C(\d+)/);
        if (m) { const n = parseInt(m[1]); if (n >= 1 && n <= 99) return String(n).padStart(2,'0'); }
        return null;
    }

    function safeNum(v) {
        const n = parseFloat(String(v || '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }

    const newAislesData = {};
    let totalArticles = 0;

    for (let i = hdr + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const codigo = String(row[COL_COD] || '').trim();
        if (!codigo || codigo.toLowerCase().includes('codigo') ||
            codigo.toLowerCase().includes('total listado') || codigo === 'nan') continue;

        const aisleId = getAisleId(row[COL_UBI]);
        if (!aisleId) continue;

        if (!newAislesData[aisleId]) newAislesData[aisleId] = [];

        const prov   = String(row[COL_PROV] || '').trim().replace(/^nan$/i, '');
        const kilos  = Math.round(safeNum(row[COL_KG]));
        const hojas  = Math.round(safeNum(row[COL_HOJAS]));

        const gramaje = extractGramaje(codigo);
        const tipo = prov.length > 5 ? prov : codigo.slice(0, 30);

        newAislesData[aisleId].push({
            id:       codigo,
            tipo:     tipo.substring(0, 80),
            gramaje:  gramaje,
            proveedor: prov ? prov.split(' ')[0] : '-',
            kilos:    kilos,
            hojas:    hojas,
            fecha_entrada: 'Sincronizado Excel Web'
        });
        totalArticles++;
    }

    if (totalArticles === 0) {
        alert('No se han encontrado artículos válidos en el Excel.');
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
    addLog('sync', `Inventario importado: ${totalArticles} artículos en ${Object.keys(newAislesData).length} pasillos`);
    alert(`✅ Inventario importado correctamente:\n• ${totalArticles} artículos importados\n• ${Object.keys(newAislesData).length} pasillos actualizados`);
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

// ─── CONFIGURACIÓN DE PASILLOS ──────────────────────────────────────────────
function renderConfigView() {
    const container = document.getElementById('config-content');
    if (!container) return;

    const aisles = Object.values(allAislesData).sort((a,b) => {
        // Ordenar numéricamente si es posible, sino alfabéticamente
        const na = parseInt(a.id), nb = parseInt(b.id);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.id.localeCompare(b.id);
    });

    let html = `
    <table class="items-table art-table">
        <thead>
            <tr>
                <th>Pasillo</th>
                <th class="text-center">Estado</th>
                <th class="text-right">Capacidad (pal)</th>
                <th class="text-right">Largo (cm)</th>
                <th class="text-right">Ancho (cm)</th>
                <th class="text-right">Alto (cm)</th>
                <th class="text-center">Acciones</th>
            </tr>
        </thead>
        <tbody>`;

    aisles.forEach(a => {
        const cfg = getAisleCfg(a.id);
        const disabled = !!cfg.disabled;
        const cap = cfg.capacity || a.capacity;
        
        html += `
        <tr data-aisle="${a.id}" style="${disabled ? 'opacity:0.6;background:rgba(0,0,0,0.1);' : ''}">
            <td><strong style="color:var(--accent);">P${a.id}</strong></td>
            <td class="text-center">
                <span class="insp-badge" style="background:${disabled ? '#374151' : '#22c55e22'};color:${disabled ? '#9ca3af' : '#22c55e'};">
                    ${disabled ? 'Deshabilitado' : 'Activo'}
                </span>
            </td>
            <td class="text-right">
                <input type="number" class="edit-input-sm cfg-cap" value="${cap}" min="1" max="999" data-id="${a.id}">
            </td>
            <td class="text-right">
                <input type="number" class="edit-input-sm cfg-l" value="${cfg.l || ''}" placeholder="0" data-id="${a.id}">
            </td>
            <td class="text-right">
                <input type="number" class="edit-input-sm cfg-w" value="${cfg.w || ''}" placeholder="0" data-id="${a.id}">
            </td>
            <td class="text-right">
                <input type="number" class="edit-input-sm cfg-h" value="${cfg.h || ''}" placeholder="0" data-id="${a.id}">
            </td>
            <td class="text-center">
                <button class="insp-action-btn ${disabled ? 'btn-enable' : 'btn-disable'}" onclick="toggleAisleDisabledFromConfig('${a.id}')" title="${disabled ? 'Habilitar' : 'Deshabilitar'}">
                    <i class="ri-${disabled ? 'checkbox-circle-line' : 'forbid-line'}"></i>
                </button>
            </td>
        </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Listeners para cambios
    container.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
            const id = inp.dataset.id;
            const cfg = getAisleCfg(id);
            if (inp.classList.contains('cfg-cap')) cfg.capacity = parseInt(inp.value) || 0;
            if (inp.classList.contains('cfg-l'))   cfg.l = parseFloat(inp.value) || 0;
            if (inp.classList.contains('cfg-w'))   cfg.w = parseFloat(inp.value) || 0;
            if (inp.classList.contains('cfg-h'))   cfg.h = parseFloat(inp.value) || 0;
            saveAisleConfig();
            renderWarehouse();
            addLog('edit', `P${id} — actualizado desde Configuración`, id);
        });
    });
}

function toggleAisleDisabledFromConfig(id) {
    const cfg = getAisleCfg(id);
    cfg.disabled = !cfg.disabled;
    saveAisleConfig();
    addLog(cfg.disabled ? 'disable' : 'enable', `Pasillo ${cfg.disabled ? 'anulado' : 'reactivado'} desde Configuración: P${id}`, id);
    renderWarehouse();
    renderConfigView();
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