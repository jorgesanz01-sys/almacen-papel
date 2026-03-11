// app.js — StoreMap · Almacén de Papel

const WAREHOUSE_LAYOUT = [
    { id: 'col-left',     blocks: [
        { id: 'nave1-der', name: 'N1 Derecho (1-17)',    start: 1,  end: 17 },
        { id: 'nave1-izq', name: 'N1 Izquierdo (43-55)', start: 43, end: 55 }
    ]},
    { id: 'col-center',   blocks: [
        { id: 'nave2-der', name: 'N2 Derecho (18-42)',   start: 18, end: 42 },
        { id: 'nave2-cen', name: 'N2 Central (63-75)',   start: 63, end: 75 },
        { id: 'nave2-izq', name: 'N2 Izquierdo (81-76)', start: 81, end: 76 }
    ]},
    { id: 'col-external', blocks: [
        { id: 'taller', name: 'Taller',         isExternal: true, extId: 'TALLER' },
        { id: 'monge',  name: 'Monge',          isExternal: true, extId: 'MONGE'  },
        { id: 'otros',  name: 'Sin Clasificar', isExternal: true, extId: 'OTROS'  }
    ]}
];

const allAislesData = {};  // id → { id, capacity, items[], blockId, disabled, customKgPerPalet }
let totalGlobalCapacity = 0;
let localSeedData = {};
let globalClickListenerAttached = false;
const activityLog = [];

// Configuraciones locales que NO van al seed (persisten en localStorage)
let aisleConfig = {};  // id → { disabled: bool, capacity: num, kgPerPalet: { refId: num } }

function loadAisleConfig() {
    try { aisleConfig = JSON.parse(localStorage.getItem('sm_aisleConfig') || '{}'); }
    catch(e) { aisleConfig = {}; }
}
function saveAisleConfig() {
    localStorage.setItem('sm_aisleConfig', JSON.stringify(aisleConfig));
}
function getAisleCfg(id) {
    if (!aisleConfig[id]) aisleConfig[id] = {};
    return aisleConfig[id];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function calcTotalKilos(items, aisleId) {
    if (!items || !items.length) return 0;
    const cfg = aisleConfig[aisleId] || {};
    const kgMap = cfg.kgPerPalet || {};
    return items.reduce((s, it) => {
        const kg = Math.max(0, it.kilos || 0);
        // Si hay un kg/palet personalizado para esta ref, recalcula
        if (kgMap[it.id] && kgMap[it.id] > 0) {
            // Estimamos palets de este item y los convertimos a kg con la escala correcta
            const originalKgPerPalet = 600;
            const origPalets = kg / originalKgPerPalet;
            return s + origPalets * kgMap[it.id];
        }
        return s + kg;
    }, 0);
}

function getCapacity(aisle) {
    const cfg = aisleConfig[aisle.id] || {};
    return cfg.capacity || aisle.capacity;
}

function isDisabled(aisle) {
    return !!(aisleConfig[aisle.id] || {}).disabled;
}

function getHeatmapClass(r) {
    if (r < 30) return 'empty';
    if (r <= 75) return 'medium';
    return 'full';
}
function getHeatmapColorHex(r) {
    if (r < 30) return '#22c55e';
    if (r <= 75) return '#f59e0b';
    return '#ef4444';
}
function fmtNum(n) { return Number(n).toLocaleString('es-ES'); }

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initMockData() {
    loadAisleConfig();
    try {
        const resp = await fetch('./seed.json');
        if (resp.ok) localSeedData = await resp.json();
    } catch(e) { console.log('No seed.json', e); }

    WAREHOUSE_LAYOUT.forEach(col => col.blocks.forEach(block => {
        if (block.type === 'empty') return;
        const list = [];
        if (block.isExternal) {
            const id = block.extId;
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

        col.blocks.forEach(block => {
            const blockEl = document.createElement('div');
            if (block.type === 'empty') { blockEl.className = 'layout-block empty-block'; colEl.appendChild(blockEl); return; }

            blockEl.className = 'layout-block';
            let html = `<div class="aisle-header"><span class="aisle-title">${block.name}</span></div>
                        <div class="racks-container ${block.isExternal ? 'single-col' : ''}">`;

            block.aisles.forEach(aisle => {
                const disabled = isDisabled(aisle);
                const cap = getCapacity(aisle);
                const kg  = calcTotalKilos(aisle.items, aisle.id);
                const pal = parseFloat((kg / 600).toFixed(1));

                if (!disabled) { totalFilled += pal; totalCap += cap; }

                const occ  = cap > 0 ? (pal / cap) * 100 : 0;
                const heat = disabled ? 'disabled' : getHeatmapClass(occ);

                html += `
                    <div class="rack aisle-unit ${heat}"
                         data-id="${aisle.id}"
                         title="${disabled ? '⛔ Pasillo anulado' : `P${aisle.id} · ${pal} pal. · ${Math.round(occ)}%`}">
                        ${disabled ? '<i class="ri-forbid-line" style="font-size:11px; color:#6b7280; z-index:1;"></i>' : ''}
                        <span class="rack-id" style="${disabled ? 'color:#4b5563;' : ''}">${aisle.id}</span>
                        <span class="aisle-badge" style="${disabled ? 'color:#374151;' : ''}">${disabled ? 'anulado' : pal + ' pal.'}</span>
                    </div>
                `;
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
    el.textContent = `${Math.round(rate)}%`;
    bar.style.width = `${Math.min(rate, 100)}%`;
    const c = getHeatmapColorHex(rate);
    el.style.color = c; bar.style.backgroundColor = c;
}

// ─── LISTENERS ────────────────────────────────────────────────────────────────
function attachAisleListeners() {
    document.querySelectorAll('.aisle-unit').forEach(el => {
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
            clone.classList.add('active');
            const data = allAislesData[clone.getAttribute('data-id')];
            if (data) showInspector(data);
        });
    });
    if (!globalClickListenerAttached) {
        document.addEventListener('click', e => {
            if (!e.target.closest('.aisle-unit') && !e.target.closest('#inspector-panel') && !e.target.closest('#edit-modal')) {
                closeInspector();
            }
        });
        globalClickListenerAttached = true;
    }
}

// ─── INSPECTOR ────────────────────────────────────────────────────────────────
window.closeInspector = function() {
    document.getElementById('inspector-panel').classList.remove('visible');
    document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
};

function showInspector(aisleData) {
    const panel = document.getElementById('inspector-panel');
    panel.className = 'inspector-panel';

    const disabled = isDisabled(aisleData);
    const cap = getCapacity(aisleData);
    const kg  = calcTotalKilos(aisleData.items, aisleData.id);
    const pal = parseFloat((kg / 600).toFixed(1));
    const occ = cap > 0 ? (pal / cap) * 100 : 0;
    const col = disabled ? '#6b7280' : getHeatmapColorHex(occ);
    const n   = aisleData.items ? aisleData.items.length : 0;

    // Agrupar items
    const grouped = {};
    (aisleData.items || []).forEach(it => {
        if (!grouped[it.id]) grouped[it.id] = { ...it, totalKilos: 0, totalHojas: 0 };
        grouped[it.id].totalKilos += Math.max(0, it.kilos || 0);
        grouped[it.id].totalHojas += Math.max(0, it.hojas || 0);
    });
    const rows = Object.values(grouped).sort((a, b) => b.totalKilos - a.totalKilos);

    // Cabecera de estado
    const statusBadge = disabled
        ? `<span class="insp-badge" style="background:#374151; color:#9ca3af;">⛔ Pasillo Anulado — no cuenta en métricas</span>`
        : `<span class="insp-badge" style="background:${col}22; color:${col};">${Math.round(occ)}% · ${pal} / ${cap} pal.</span>`;

    let html = `
        <div class="inspector-header">
            <div>
                <h3 class="insp-title">Pasillo ${aisleData.id}</h3>
                ${statusBadge}
            </div>
            <div style="display:flex; gap:6px; align-items:flex-start;">
                <button class="insp-action-btn" onclick="window.openEditModal('${aisleData.id}')" title="Editar configuración">
                    <i class="ri-settings-3-line"></i>
                </button>
                <button class="insp-action-btn ${disabled ? 'btn-enable' : 'btn-disable'}"
                        onclick="window.toggleAisleDisabled('${aisleData.id}')"
                        title="${disabled ? 'Activar pasillo' : 'Anular pasillo'}">
                    <i class="ri-${disabled ? 'checkbox-circle-line' : 'forbid-line'}"></i>
                </button>
                <button class="insp-action-btn btn-close" onclick="window.closeInspector()" title="Cerrar">
                    <i class="ri-close-line"></i>
                </button>
            </div>
        </div>
        <div class="items-list-container">
    `;

    if (rows.length > 0) {
        const cfg    = aisleConfig[aisleData.id] || {};
        const kgMap  = cfg.kgPerPalet || {};
        html += `
            <table class="items-table">
                <thead><tr>
                    <th>Código</th><th>Descripción</th>
                    <th style="text-align:right">Hojas</th>
                    <th style="text-align:right">Kg reales</th>
                    <th style="text-align:right">Kg/pal</th>
                    <th style="text-align:center">Pal. est.</th>
                </tr></thead>
                <tbody>
        `;
        rows.forEach(g => {
            const kgPerPal = kgMap[g.id] || 600;
            const palEst   = (g.totalKilos / kgPerPal).toFixed(1);
            const isCustom = !!kgMap[g.id];
            html += `
                <tr>
                    <td class="ref-code">${g.id}</td>
                    <td class="ref-desc" title="${g.tipo}">${g.tipo}</td>
                    <td style="text-align:right; font-size:11px;">${fmtNum(g.totalHojas)}</td>
                    <td style="text-align:right; font-size:11px; color:#9ca3af;">${fmtNum(g.totalKilos)}</td>
                    <td style="text-align:right; font-size:11px;">
                        <span style="${isCustom ? 'color:var(--accent); font-weight:700;' : 'color:#6b7280;'}">${fmtNum(kgPerPal)}</span>
                    </td>
                    <td style="text-align:center;">
                        <span class="pal-badge">${palEst}</span>
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
    } else {
        html += `<div class="empty-state"><i class="ri-inbox-line"></i><p>Pasillo vacío</p></div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;
    panel.classList.add('visible');
}

// ─── TOGGLE ANULAR PASILLO ────────────────────────────────────────────────────
window.toggleAisleDisabled = function(id) {
    const cfg = getAisleCfg(id);
    cfg.disabled = !cfg.disabled;
    saveAisleConfig();
    const label = cfg.disabled ? 'Pasillo anulado' : 'Pasillo reactivado';
    addLog(cfg.disabled ? 'disable' : 'enable', `${label}: P${id}`, id);
    renderWarehouse();
    showInspector(allAislesData[id]);
};

// ─── MODAL DE EDICIÓN ─────────────────────────────────────────────────────────
window.openEditModal = function(id) {
    const aisle  = allAislesData[id];
    const cfg    = getAisleCfg(id);
    const cap    = cfg.capacity || aisle.capacity;
    const kgMap  = cfg.kgPerPalet || {};

    // Agrupar refs
    const grouped = {};
    (aisle.items || []).forEach(it => {
        if (!grouped[it.id]) grouped[it.id] = { ...it, totalKilos: 0 };
        grouped[it.id].totalKilos += Math.max(0, it.kilos || 0);
    });
    const refs = Object.values(grouped).sort((a, b) => b.totalKilos - a.totalKilos);

    let refsHtml = '';
    refs.forEach(ref => {
        const custom = kgMap[ref.id] || '';
        refsHtml += `
            <div class="edit-ref-row">
                <div class="edit-ref-info">
                    <span class="edit-ref-code">${ref.id}</span>
                    <span class="edit-ref-desc" title="${ref.tipo}">${ref.tipo}</span>
                </div>
                <div class="edit-ref-input-wrap">
                    <label>Kg/palet</label>
                    <input type="number" min="1" max="99999"
                           class="edit-input-small"
                           data-ref="${ref.id}"
                           placeholder="600"
                           value="${custom}">
                </div>
            </div>
        `;
    });

    const modal = document.getElementById('edit-modal');
    modal.innerHTML = `
        <div class="edit-modal-box" onclick="event.stopPropagation()">
            <div class="edit-modal-header">
                <h3><i class="ri-settings-3-line"></i> Configurar Pasillo ${id}</h3>
                <button class="insp-action-btn btn-close" onclick="window.closeEditModal()">
                    <i class="ri-close-line"></i>
                </button>
            </div>
            <div class="edit-modal-body">
                <div class="edit-section">
                    <label class="edit-label">Capacidad máxima (palets)</label>
                    <input type="number" id="edit-capacity" min="1" max="9999"
                           class="edit-input" value="${cap}" placeholder="${aisle.capacity}">
                    <span class="edit-hint">Por defecto: ${aisle.capacity} palets</span>
                </div>
                ${refs.length > 0 ? `
                <div class="edit-section">
                    <label class="edit-label">Kg por palet por referencia</label>
                    <span class="edit-hint">Por defecto: 600 kg/palet. Ajusta para cada bobina/palet cortado.</span>
                    <div class="edit-refs-list">${refsHtml}</div>
                </div>` : ''}
            </div>
            <div class="edit-modal-footer">
                <button class="btn-secondary" onclick="window.resetAisleCfg('${id}')">
                    <i class="ri-refresh-line"></i> Restaurar por defecto
                </button>
                <button class="btn-primary" onclick="window.saveEditModal('${id}')">
                    <i class="ri-save-line"></i> Guardar
                </button>
            </div>
        </div>
    `;
    modal.classList.add('visible');
};

window.closeEditModal = function() {
    document.getElementById('edit-modal').classList.remove('visible');
};

window.saveEditModal = function(id) {
    const cfg     = getAisleCfg(id);
    const capVal  = parseInt(document.getElementById('edit-capacity').value);
    if (capVal > 0) cfg.capacity = capVal;

    cfg.kgPerPalet = cfg.kgPerPalet || {};
    document.querySelectorAll('.edit-input-small').forEach(inp => {
        const ref = inp.getAttribute('data-ref');
        const val = parseFloat(inp.value);
        if (val > 0) cfg.kgPerPalet[ref] = val;
        else delete cfg.kgPerPalet[ref];
    });

    saveAisleConfig();
    addLog('edit', `P${id} — configuración actualizada`, id);
    window.closeEditModal();
    renderWarehouse();
    showInspector(allAislesData[id]);
};

window.resetAisleCfg = function(id) {
    if (!confirm(`¿Restaurar la configuración por defecto del pasillo ${id}?`)) return;
    delete aisleConfig[id];
    saveAisleConfig();
    addLog('edit', `P${id} — configuración restaurada`, id);
    window.closeEditModal();
    renderWarehouse();
    showInspector(allAislesData[id]);
};

// ─── BÚSQUEDA ─────────────────────────────────────────────────────────────────
function setupSearch() {
    const inp = document.getElementById('search-input');
    if (!inp) return;
    inp.addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) {
            document.querySelectorAll('.aisle-unit').forEach(el => { el.style.opacity = '1'; el.style.outline = ''; });
            return;
        }
        const hits = new Set();
        Object.values(allAislesData).forEach(a => {
            const match = a.id.toLowerCase().includes(q) ||
                (a.items || []).some(it =>
                    (it.id && it.id.toLowerCase().includes(q)) ||
                    (it.tipo && it.tipo.toLowerCase().includes(q)) ||
                    (it.gramaje && it.gramaje.toLowerCase().includes(q)) ||
                    (it.proveedor && it.proveedor.toLowerCase().includes(q))
                );
            if (match) hits.add(a.id);
        });
        document.querySelectorAll('.aisle-unit').forEach(el => {
            const id = el.getAttribute('data-id');
            if (hits.has(id)) { el.style.opacity = '1'; el.style.outline = '2px solid var(--accent)'; el.style.outlineOffset = '1px'; }
            else { el.style.opacity = '0.15'; el.style.outline = ''; }
        });
        if (hits.size === 1) {
            const [sid] = hits;
            const el = document.querySelector(`.aisle-unit[data-id="${sid}"]`);
            if (el) { document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active')); el.classList.add('active'); }
            showInspector(allAislesData[sid]);
        }
    });
    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { inp.value = ''; inp.dispatchEvent(new Event('input')); window.closeInspector(); }
    });
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────────────────────
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ['map','metrics','history'].forEach(v => {
                const el = document.getElementById(`view-${v}`);
                el.style.display = v === view ? 'flex' : 'none';
                el.classList.toggle('active', v === view);
            });
            if (view === 'metrics') renderMetrics();
            if (view === 'history') renderHistory();
            window.closeInspector();
        });
    });
    document.getElementById('view-map').style.display     = 'flex';
    document.getElementById('view-metrics').style.display = 'none';
    document.getElementById('view-history').style.display = 'none';
}

// ─── MÉTRICAS ─────────────────────────────────────────────────────────────────
function renderMetrics() {
    const aisles = Object.values(allAislesData);
    let totalKg = 0, totalPal = 0, totalItems = 0, ocupados = 0, vacios = 0, saturados = 0, anulados = 0;
    aisles.forEach(a => {
        if (isDisabled(a)) { anulados++; return; }
        const kg  = calcTotalKilos(a.items, a.id);
        const pal = kg / 600;
        const occ = (pal / getCapacity(a)) * 100;
        totalKg += kg; totalPal += pal; totalItems += (a.items?.length || 0);
        if (kg > 0) ocupados++; else vacios++;
        if (occ > 75) saturados++;
    });
    document.getElementById('metrics-kpis').innerHTML = `
        <div class="metric-card"><div class="metric-label">Total Kilos</div><div class="metric-value" style="color:var(--accent)">${fmtNum(Math.round(totalKg))}</div><div class="metric-sub">en almacén</div></div>
        <div class="metric-card"><div class="metric-label">Palets Est.</div><div class="metric-value">${fmtNum(Math.round(totalPal))}</div><div class="metric-sub">total estimado</div></div>
        <div class="metric-card"><div class="metric-label">Referencias</div><div class="metric-value">${fmtNum(totalItems)}</div><div class="metric-sub">líneas de stock</div></div>
        <div class="metric-card"><div class="metric-label">Ocupados</div><div class="metric-value" style="color:var(--heat-medium)">${ocupados}</div><div class="metric-sub">con stock</div></div>
        <div class="metric-card"><div class="metric-label">Vacíos</div><div class="metric-value" style="color:var(--heat-empty)">${vacios}</div><div class="metric-sub">libres</div></div>
        <div class="metric-card"><div class="metric-label">Anulados</div><div class="metric-value" style="color:#6b7280">${anulados}</div><div class="metric-sub">fuera de cálculo</div></div>
    `;
    const sorted = aisles
        .filter(a => !isDisabled(a))
        .map(a => {
            const kg  = calcTotalKilos(a.items, a.id);
            const pal = parseFloat((kg / 600).toFixed(1));
            const occ = Math.round((pal / getCapacity(a)) * 100);
            return { id: a.id, pal, occ };
        })
        .filter(a => a.pal > 0)
        .sort((a, b) => b.occ - a.occ)
        .slice(0, 15);
    const maxPal = Math.max(...sorted.map(a => a.pal), 1);
    document.getElementById('metrics-top-body').innerHTML = sorted.map(a => {
        const c   = getHeatmapColorHex(a.occ);
        const pct = Math.min((a.pal / maxPal) * 100, 100);
        return `<div class="top-list-row" onclick="goToAisle('${a.id}')">
            <span class="row-id">P${a.id}</span>
            <div class="row-bar-wrap"><div class="row-bar" style="width:${pct}%; background:${c};"></div></div>
            <span class="row-palets">${a.pal} pal.</span>
            <span class="row-pct" style="color:${c};">${a.occ}%</span>
        </div>`;
    }).join('');
}

window.goToAisle = function(id) {
    document.querySelector('[data-view="map"]').click();
    setTimeout(() => {
        const el = document.querySelector(`.aisle-unit[data-id="${id}"]`);
        if (el) { document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active')); el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); showInspector(allAislesData[id]); }
    }, 100);
};

// ─── HISTORIAL ────────────────────────────────────────────────────────────────
function addLog(type, desc, aisleId) {
    const colors = { system: '#6366f1', update: '#f59e0b', sync: '#22c55e', error: '#ef4444', edit: '#a78bfa', disable: '#6b7280', enable: '#22c55e' };
    activityLog.unshift({ type, desc, aisleId: aisleId || null, time: new Date(), color: colors[type] || '#6b7280' });
    if (activityLog.length > 60) activityLog.pop();
}

function renderHistory() {
    const el = document.getElementById('history-list');
    if (!activityLog.length) { el.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-muted); font-size:12px; font-family:var(--font-mono);">Sin actividad</div>`; return; }
    el.innerHTML = activityLog.map(log => {
        const t = log.time;
        const ts = `${t.toLocaleDateString('es-ES')} ${t.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' })}`;
        const badge = log.aisleId ? `<span class="history-badge" style="background:${log.color}22; color:${log.color};">P${log.aisleId}</span>` : '';
        return `<div class="history-row"><div class="history-dot" style="background:${log.color};"></div><span class="history-time">${ts}</span><span class="history-desc">${log.desc}</span>${badge}</div>`;
    }).join('');
}

// ─── FIRESTORE ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await initMockData();
    renderWarehouse();
    setupSearch();
    setupNavigation();

    // Cerrar modal al clicar fuera
    document.getElementById('edit-modal').addEventListener('click', () => window.closeEditModal());

    if (window.firebaseDb) {
        const statusEl = document.querySelector('.status-indicator');
        statusEl.textContent = 'Conectando...';
        const db = window.firebaseDb;
        const colRef = window.firebaseCollection(db, 'almacen');

        document.getElementById('force-sync-btn').addEventListener('click', async () => {
            if (!confirm('¿Sobreescribir TODOS los pasillos en Firestore con seed.json?\n\nEsto borrará cambios manuales en Firebase (no las configuraciones locales).')) return;
            statusEl.textContent = 'Sincronizando...';
            document.getElementById('force-sync-btn').disabled = true;
            try {
                await Promise.all(Object.keys(allAislesData).map(id =>
                    window.firebaseSetDoc(window.firebaseDoc(db, 'almacen', id), { items: localSeedData[id]?.items || [] })
                ));
                addLog('sync', 'Sincronización forzada desde Excel');
                alert('¡Completado!'); statusEl.textContent = 'En vivo (Firestore)';
            } catch(e) { addLog('error', e.message); alert('Error: ' + e.message); statusEl.textContent = 'Error'; }
            document.getElementById('force-sync-btn').disabled = false;
        });

        let isFirstLoad = true;
        window.firebaseOnSnapshot(colRef, snapshot => {
            if (snapshot.empty && isFirstLoad) {
                statusEl.textContent = 'Volcando datos...';
                Promise.all(Object.keys(allAislesData).map(id =>
                    window.firebaseSetDoc(window.firebaseDoc(db, 'almacen', id), { items: allAislesData[id].items || [] })
                )).then(() => addLog('sync', 'Datos iniciales volcados')).catch(console.error);
            } else if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    const id = doc.id, data = doc.data();
                    if (allAislesData[id]) {
                        const prev = JSON.stringify(allAislesData[id].items);
                        const next = Array.isArray(data.items) ? data.items : [];
                        if (!isFirstLoad && prev !== JSON.stringify(next)) addLog('update', `P${id} actualizado`, id);
                        allAislesData[id].items = next;
                    }
                });
                statusEl.textContent = 'En vivo (Firestore)';
                renderWarehouse();
                const active = document.querySelector('.aisle-unit.active');
                if (active) { const id = active.getAttribute('data-id'); if (allAislesData[id]) showInspector(allAislesData[id]); }
            }
            isFirstLoad = false;
        }, err => { addLog('error', err.message); statusEl.textContent = 'Error (local)'; });
    }
});