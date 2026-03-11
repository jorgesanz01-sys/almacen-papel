// app.js — StoreMap · Almacén de Papel

const WAREHOUSE_LAYOUT = [
    {
        id: 'col-left',
        blocks: [
            { id: 'nave1-der', name: 'N1 Derecho (1-17)',   start: 1,  end: 17 },
            { id: 'nave1-izq', name: 'N1 Izquierdo (43-55)', start: 43, end: 55 }
        ]
    },
    {
        id: 'col-center',
        blocks: [
            { id: 'nave2-der', name: 'N2 Derecho (18-42)',  start: 18, end: 42 },
            { id: 'nave2-cen', name: 'N2 Central (63-75)',  start: 63, end: 75 },
            { id: 'nave2-izq', name: 'N2 Izquierdo (81-76)', start: 81, end: 76 }
        ]
    },
    {
        id: 'col-external',
        blocks: [
            { id: 'taller', name: 'Taller',         isExternal: true, extId: 'TALLER' },
            { id: 'monge',  name: 'Monge',          isExternal: true, extId: 'MONGE'  },
            { id: 'otros',  name: 'Sin Clasificar', isExternal: true, extId: 'OTROS'  }
        ]
    }
];

const allAislesData = {};
let totalGlobalCapacity = 0;
let localSeedData = {};
let globalClickListenerAttached = false;

// Historial en memoria (se genera al arrancar y se actualiza con cambios de Firestore)
const activityLog = [];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function calcTotalKilos(items) {
    if (!items || !items.length) return 0;
    return items.reduce((s, it) => s + Math.max(0, it.kilos || 0), 0);
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

function fmtNum(n) { return n.toLocaleString('es-ES'); }

// ─── INIT DATA ────────────────────────────────────────────────────────────────
async function initMockData() {
    try {
        const resp = await fetch('./seed.json');
        if (resp.ok) { localSeedData = await resp.json(); }
    } catch(e) { console.log('No seed.json', e); }

    WAREHOUSE_LAYOUT.forEach(col => {
        col.blocks.forEach(block => {
            if (block.type === 'empty') return;
            const aislesList = [];

            if (block.isExternal) {
                const id = block.extId;
                const items = localSeedData[id]?.items || [];
                const obj = { id, capacity: 500, items, blockId: block.id };
                aislesList.push(obj);
                allAislesData[id] = obj;
                totalGlobalCapacity += 500;
            } else {
                const asc  = block.start <= block.end;
                const step = asc ? 1 : -1;
                for (let i = block.start; asc ? i <= block.end : i >= block.end; i += step) {
                    const id    = String(i).padStart(2, '0');
                    const items = localSeedData[id]?.items || [];
                    const obj   = { id, capacity: 24, items, blockId: block.id };
                    aislesList.push(obj);
                    allAislesData[id] = obj;
                    totalGlobalCapacity += 24;
                }
            }
            block.aisles = aislesList;
        });
    });

    // Registro inicial en el historial
    addLog('system', 'Almacén cargado desde seed.json');
}

// ─── RENDER MAPA ──────────────────────────────────────────────────────────────
function renderWarehouse() {
    const gridEl = document.getElementById('warehouse-grid');
    gridEl.innerHTML = '';
    let totalFilled = 0;

    WAREHOUSE_LAYOUT.forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'layout-column';

        col.blocks.forEach(block => {
            const blockEl = document.createElement('div');
            if (block.type === 'empty') {
                blockEl.className = 'layout-block empty-block';
                colEl.appendChild(blockEl);
                return;
            }

            blockEl.className = 'layout-block';
            const containerClass = block.isExternal ? 'single-col' : '';
            let html = `
                <div class="aisle-header">
                    <span class="aisle-title">${block.name}</span>
                </div>
                <div class="racks-container ${containerClass}">
            `;

            block.aisles.forEach(aisle => {
                const kg  = calcTotalKilos(aisle.items);
                const pal = parseFloat((kg / 600).toFixed(1));
                totalFilled += pal;
                const occ   = (pal / aisle.capacity) * 100;
                const heat  = getHeatmapClass(occ);

                html += `
                    <div class="rack aisle-unit ${heat}"
                         data-id="${aisle.id}"
                         title="Pasillo ${aisle.id} · ${pal} pal. · ${Math.round(occ)}%">
                        <span class="rack-id">P${aisle.id}</span>
                        <span class="aisle-badge">${pal} pal.</span>
                    </div>
                `;
            });

            html += '</div>';
            blockEl.innerHTML = html;
            colEl.appendChild(blockEl);
        });

        gridEl.appendChild(colEl);
    });

    updateGlobalMetrics(totalFilled, totalGlobalCapacity);
    attachAisleListeners();
}

function updateGlobalMetrics(filled, total) {
    const rate = total === 0 ? 0 : (filled / total) * 100;
    const el  = document.getElementById('global-ocupation');
    const bar = document.getElementById('global-progress');
    el.textContent = `${Math.round(rate)}%`;
    bar.style.width = `${Math.min(rate, 100)}%`;
    const c = getHeatmapColorHex(rate);
    el.style.color = c;
    bar.style.backgroundColor = c;
}

// ─── LISTENERS PASILLOS ───────────────────────────────────────────────────────
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
            if (!e.target.closest('.aisle-unit') && !e.target.closest('#inspector-panel')) {
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
    panel.className = 'inspector-panel wide-panel';

    const kg  = calcTotalKilos(aisleData.items);
    const pal = parseFloat((kg / 600).toFixed(1));
    const occ = (pal / aisleData.capacity) * 100;
    const col = getHeatmapColorHex(occ);
    const n   = aisleData.items ? aisleData.items.length : 0;

    let html = `
        <div class="inspector-header">
            <div>
                <h3 style="font-size:20px; color:var(--accent); font-family:var(--font-mono);">
                    Pasillo ${aisleData.id}
                </h3>
                <span style="display:inline-block; margin-top:5px; padding:3px 10px;
                             background:${col}22; color:${col};
                             border-radius:5px; font-size:12px; font-weight:700;
                             font-family:var(--font-mono);">
                    ${Math.round(occ)}% · ${pal} / ${aisleData.capacity} pal.
                </span>
            </div>
            <button class="close-inspector" onclick="closeInspector()">
                <i class="ri-close-line"></i>
            </button>
        </div>
        <div class="items-list-container">
    `;

    if (n > 0) {
        const grouped = {};
        aisleData.items.forEach(item => {
            if (!grouped[item.id]) grouped[item.id] = { ...item, totalKilos: 0, totalHojas: 0 };
            grouped[item.id].totalKilos += Math.max(0, item.kilos || 0);
            grouped[item.id].totalHojas += Math.max(0, item.hojas || 0);
        });

        const rows = Object.values(grouped).sort((a, b) => b.totalKilos - a.totalKilos);

        html += `
            <table class="items-table">
                <thead><tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th style="text-align:right">Hojas</th>
                    <th style="text-align:right">Kg</th>
                    <th style="text-align:center">Pal.</th>
                </tr></thead>
                <tbody>
        `;

        rows.forEach(g => {
            const p = (g.totalKilos / 600).toFixed(1);
            html += `
                <tr>
                    <td style="color:var(--accent); font-weight:700; font-size:10px;">${g.id}</td>
                    <td style="font-size:11px; max-width:190px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${g.tipo}">${g.tipo}</td>
                    <td style="text-align:right; font-size:11px;">${fmtNum(g.totalHojas)}</td>
                    <td style="text-align:right; font-size:11px; color:#9ca3af;">${fmtNum(g.totalKilos)}</td>
                    <td style="text-align:center;">
                        <span style="background:rgba(255,255,255,0.08); padding:1px 7px; border-radius:10px; font-size:10px;">${p}</span>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
    } else {
        html += `
            <div style="text-align:center; padding:40px 0; color:var(--text-muted)">
                <i class="ri-inbox-line" style="font-size:30px; opacity:.4;"></i>
                <p style="margin-top:10px; font-size:14px;">Pasillo vacío</p>
            </div>
        `;
    }

    html += '</div>';
    panel.innerHTML = html;
    panel.classList.add('visible');
}

// ─── BÚSQUEDA ─────────────────────────────────────────────────────────────────
function setupSearch() {
    const inp = document.getElementById('search-input');
    if (!inp) return;

    inp.addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();

        if (!q) {
            document.querySelectorAll('.aisle-unit').forEach(el => {
                el.style.opacity = '1';
                el.style.outline = '';
            });
            return;
        }

        const hits = new Set();
        Object.values(allAislesData).forEach(aisle => {
            const match =
                aisle.id.toLowerCase().includes(q) ||
                (aisle.items || []).some(it =>
                    (it.id       && it.id.toLowerCase().includes(q))       ||
                    (it.tipo     && it.tipo.toLowerCase().includes(q))     ||
                    (it.gramaje  && it.gramaje.toLowerCase().includes(q))  ||
                    (it.proveedor && it.proveedor.toLowerCase().includes(q))
                );
            if (match) hits.add(aisle.id);
        });

        document.querySelectorAll('.aisle-unit').forEach(el => {
            const id = el.getAttribute('data-id');
            if (hits.has(id)) {
                el.style.opacity = '1';
                el.style.outline = '2px solid var(--accent)';
                el.style.outlineOffset = '1px';
            } else {
                el.style.opacity = '0.15';
                el.style.outline = '';
            }
        });

        if (hits.size === 1) {
            const [sid] = hits;
            const el = document.querySelector(`.aisle-unit[data-id="${sid}"]`);
            if (el) { document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active')); el.classList.add('active'); }
            showInspector(allAislesData[sid]);
        }
    });

    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            inp.value = '';
            inp.dispatchEvent(new Event('input'));
            closeInspector();
        }
    });
}

// ─── VISTAS ──────────────────────────────────────────────────────────────────
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');

            // Nav activo
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Mostrar vista
            document.getElementById('view-map').style.display     = view === 'map'     ? 'flex' : 'none';
            document.getElementById('view-metrics').style.display = view === 'metrics' ? 'flex' : 'none';
            document.getElementById('view-history').style.display = view === 'history' ? 'flex' : 'none';

            // Clases active para flex columns
            ['view-map','view-metrics','view-history'].forEach(id => {
                const el = document.getElementById(id);
                if (id === `view-${view}`) el.classList.add('active');
                else el.classList.remove('active');
            });

            if (view === 'metrics') renderMetrics();
            if (view === 'history') renderHistory();

            closeInspector();
        });
    });

    // Estado inicial
    document.getElementById('view-map').style.display     = 'flex';
    document.getElementById('view-metrics').style.display = 'none';
    document.getElementById('view-history').style.display = 'none';
}

// ─── MÉTRICAS ─────────────────────────────────────────────────────────────────
function renderMetrics() {
    const aisles = Object.values(allAislesData);

    // Calcular KPIs globales
    let totalKg = 0, totalPal = 0, totalItems = 0;
    let aislesOcupados = 0, aislesVacios = 0, aislesSaturados = 0;

    aisles.forEach(a => {
        const kg  = calcTotalKilos(a.items);
        const pal = kg / 600;
        const occ = (pal / a.capacity) * 100;
        totalKg    += kg;
        totalPal   += pal;
        totalItems += (a.items ? a.items.length : 0);
        if (kg > 0) aislesOcupados++;
        else aislesVacios++;
        if (occ > 75) aislesSaturados++;
    });

    const kpiEl = document.getElementById('metrics-kpis');
    kpiEl.innerHTML = `
        <div class="metric-card">
            <div class="metric-label">Total Kilos</div>
            <div class="metric-value" style="color:var(--accent)">${fmtNum(Math.round(totalKg))}</div>
            <div class="metric-sub">en almacén</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Palets Est.</div>
            <div class="metric-value">${fmtNum(Math.round(totalPal))}</div>
            <div class="metric-sub">total estimado</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Referencias</div>
            <div class="metric-value">${fmtNum(totalItems)}</div>
            <div class="metric-sub">líneas de stock</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Pasillos Ocup.</div>
            <div class="metric-value" style="color:var(--heat-medium)">${aislesOcupados}</div>
            <div class="metric-sub">con stock</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Vacíos</div>
            <div class="metric-value" style="color:var(--heat-empty)">${aislesVacios}</div>
            <div class="metric-sub">libres</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Saturados</div>
            <div class="metric-value" style="color:var(--heat-full)">${aislesSaturados}</div>
            <div class="metric-sub">&gt;75% ocupación</div>
        </div>
    `;

    // Top pasillos por ocupación
    const sorted = aisles
        .map(a => {
            const kg  = calcTotalKilos(a.items);
            const pal = parseFloat((kg / 600).toFixed(1));
            const occ = (pal / a.capacity) * 100;
            return { id: a.id, pal, occ: Math.round(occ) };
        })
        .filter(a => a.pal > 0)
        .sort((a, b) => b.occ - a.occ)
        .slice(0, 15);

    const maxPal = Math.max(...sorted.map(a => a.pal));
    const body   = document.getElementById('metrics-top-body');
    body.innerHTML = sorted.map(a => {
        const color = getHeatmapColorHex(a.occ);
        const pct   = Math.min((a.pal / maxPal) * 100, 100);
        return `
            <div class="top-list-row" onclick="goToAisle('${a.id}')">
                <span class="row-id">P${a.id}</span>
                <div class="row-bar-wrap">
                    <div class="row-bar" style="width:${pct}%; background:${color};"></div>
                </div>
                <span class="row-palets">${a.pal} pal.</span>
                <span class="row-pct" style="color:${color};">${a.occ}%</span>
            </div>
        `;
    }).join('');
}

// Navegar al pasillo desde métricas
function goToAisle(id) {
    document.querySelector('[data-view="map"]').click();
    setTimeout(() => {
        const el = document.querySelector(`.aisle-unit[data-id="${id}"]`);
        if (el) {
            document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
            el.classList.add('active');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showInspector(allAislesData[id]);
        }
    }, 100);
}

// ─── HISTORIAL ────────────────────────────────────────────────────────────────
function addLog(type, desc, aisleId) {
    const colors = { system: '#6366f1', update: '#f59e0b', sync: '#22c55e', error: '#ef4444' };
    activityLog.unshift({
        type,
        desc,
        aisleId: aisleId || null,
        time: new Date(),
        color: colors[type] || '#6b7280'
    });
    if (activityLog.length > 50) activityLog.pop();
}

function renderHistory() {
    const el = document.getElementById('history-list');
    if (!activityLog.length) {
        el.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-muted); font-size:12px; font-family:var(--font-mono);">Sin actividad registrada</div>`;
        return;
    }

    el.innerHTML = activityLog.map(log => {
        const t = log.time;
        const timeStr = `${t.toLocaleDateString('es-ES')} ${t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
        const badge = log.type === 'update' ? `<span class="history-badge" style="background:${log.color}22; color:${log.color};">${log.aisleId ? 'P' + log.aisleId : ''}</span>` : '';
        return `
            <div class="history-row">
                <div class="history-dot" style="background:${log.color}; box-shadow:0 0 6px ${log.color}44;"></div>
                <span class="history-time">${timeStr}</span>
                <span class="history-desc">${log.desc}</span>
                ${badge}
            </div>
        `;
    }).join('');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await initMockData();
    renderWarehouse();
    setupSearch();
    setupNavigation();

    if (window.firebaseDb) {
        const statusEl = document.querySelector('.status-indicator');
        statusEl.textContent = 'Conectando...';

        const db     = window.firebaseDb;
        const colRef = window.firebaseCollection(db, 'almacen');

        const forceBtn = document.getElementById('force-sync-btn');
        if (forceBtn) {
            forceBtn.addEventListener('click', async () => {
                if (!confirm('¿Sobreescribir TODOS los pasillos en Firestore con seed.json?\n\nEsto borrará cambios manuales.')) return;
                statusEl.textContent = 'Sincronizando...';
                forceBtn.disabled = true;
                try {
                    const promises = Object.keys(allAislesData).map(id =>
                        window.firebaseSetDoc(window.firebaseDoc(db, 'almacen', id), {
                            items: localSeedData[id]?.items || []
                        })
                    );
                    await Promise.all(promises);
                    addLog('sync', 'Sincronización forzada desde Excel completada');
                    alert('¡Sincronización completada!');
                    statusEl.textContent = 'En vivo (Firestore)';
                } catch(e) {
                    addLog('error', 'Error en sincronización: ' + e.message);
                    alert('Error: ' + e.message);
                    statusEl.textContent = 'Error Firestore';
                }
                forceBtn.disabled = false;
            });
        }

        let isFirstLoad = true;

        window.firebaseOnSnapshot(colRef, snapshot => {
            if (snapshot.empty && isFirstLoad) {
                statusEl.textContent = 'Volcando datos...';
                const promises = Object.keys(allAislesData).map(id =>
                    window.firebaseSetDoc(window.firebaseDoc(db, 'almacen', id), {
                        items: allAislesData[id].items || []
                    })
                );
                Promise.all(promises)
                    .then(() => addLog('sync', 'Datos iniciales volcados a Firestore'))
                    .catch(e => console.error(e));
            } else if (!snapshot.empty) {
                let changes = 0;
                snapshot.forEach(docSnap => {
                    const id   = docSnap.id;
                    const data = docSnap.data();
                    if (allAislesData[id]) {
                        const prev = JSON.stringify(allAislesData[id].items);
                        const next = Array.isArray(data.items) ? data.items : [];
                        if (prev !== JSON.stringify(next) && !isFirstLoad) {
                            addLog('update', `Pasillo ${id} actualizado desde Firestore`, id);
                            changes++;
                        }
                        allAislesData[id].items = next;
                    }
                });

                statusEl.textContent = 'En vivo (Firestore)';
                renderWarehouse();

                const active = document.querySelector('.aisle-unit.active');
                if (active) {
                    const id = active.getAttribute('data-id');
                    if (allAislesData[id]) showInspector(allAislesData[id]);
                }
            }
            isFirstLoad = false;
        }, err => {
            console.error(err);
            addLog('error', 'Error Firestore: ' + err.message);
            statusEl.textContent = 'Error (usando local)';
        });
    }
});