// app.js - Corregido: bugs de itemCount, listeners duplicados, búsqueda, kilos negativos

const WAREHOUSE_LAYOUT = [
    {
        id: 'col-left',
        blocks: [
            { id: 'nave1-der', name: 'N1 Derecho (1-17)', start: 1, end: 17 },
            { id: 'nave1-izq', name: 'N1 Izquierdo (43-55)', start: 43, end: 55 }
        ]
    },
    {
        id: 'col-center',
        blocks: [
            { id: 'nave2-der', name: 'N2 Derecho (18-42)', start: 18, end: 42 },
            { id: 'nave2-cen', name: 'N2 Central (63-75)', start: 63, end: 75 },
            { id: 'nave2-izq', name: 'N2 Izquierdo (81-76)', start: 81, end: 76 }
        ]
    },
    {
        id: 'col-external',
        blocks: [
            { id: 'taller', name: 'Taller', isExternal: true, extId: 'TALLER' },
            { id: 'monge', name: 'Monge', isExternal: true, extId: 'MONGE' },
            { id: 'otros', name: 'Sin Clasificar', isExternal: true, extId: 'OTROS' }
        ]
    }
];

const allAislesData = {};
let totalGlobalCapacity = 0;
let localSeedData = {};

// FIX: un solo listener global, registrado una sola vez
let globalClickListenerAttached = false;

async function initMockData() {
    try {
        const resp = await fetch('./seed.json');
        if (resp.ok) {
            localSeedData = await resp.json();
            console.log("Cargados datos base de seed.json");
        }
    } catch(e) {
        console.log("No seed.json found", e);
    }

    WAREHOUSE_LAYOUT.forEach(col => {
        col.blocks.forEach(block => {
            if (block.type === 'empty') return;
            const aislesList = [];

            if (block.isExternal) {
                const aisleId = block.extId;
                const maxCapacity = 500;
                const items = localSeedData[aisleId] ? localSeedData[aisleId].items : [];
                const aisleObj = { id: aisleId, capacity: maxCapacity, items: items, blockId: block.id };
                aislesList.push(aisleObj);
                allAislesData[aisleId] = aisleObj;
                totalGlobalCapacity += maxCapacity;
            } else {
                const isAsc = block.start <= block.end;
                const step = isAsc ? 1 : -1;

                for (let i = block.start; isAsc ? i <= block.end : i >= block.end; i += step) {
                    // FIX: clave siempre con padStart para coincidir con seed.json
                    const aisleId = String(i).padStart(2, '0');
                    const maxCapacity = 24;
                    const items = localSeedData[aisleId] ? localSeedData[aisleId].items : [];
                    const aisleObj = { id: aisleId, capacity: maxCapacity, items: items, blockId: block.id };
                    aislesList.push(aisleObj);
                    allAislesData[aisleId] = aisleObj;
                    totalGlobalCapacity += maxCapacity;
                }
            }
            block.aisles = aislesList;
        });
    });
}

function getHeatmapClass(occupancyRate) {
    if (occupancyRate < 30) return 'empty';
    if (occupancyRate <= 75) return 'medium';
    return 'full';
}

function getHeatmapColorHex(occupancyRate) {
    if (occupancyRate < 30) return '#22c55e';
    if (occupancyRate <= 75) return '#f59e0b';
    return '#ef4444';
}

// FIX: helper para calcular kilos totales ignorando valores negativos
function calcTotalKilos(items) {
    if (!items || items.length === 0) return 0;
    return items.reduce((sum, it) => sum + Math.max(0, it.kilos || 0), 0);
}

function renderWarehouse() {
    const gridEl = document.getElementById('warehouse-grid');
    gridEl.innerHTML = '';

    let totalGlobalFilled = 0;

    WAREHOUSE_LAYOUT.forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'layout-column';

        col.blocks.forEach(block => {
            const blockEl = document.createElement('div');

            if (block.type === 'empty') {
                blockEl.className = 'layout-block empty-block';
                blockEl.style.minHeight = '600px';
                colEl.appendChild(blockEl);
                return;
            }

            blockEl.className = 'layout-block';
            const containerClass = block.isExternal ? 'single-col' : '';
            let blockHtml = `
                <div class="aisle-header">
                    <span class="aisle-title">${block.name}</span>
                </div>
                <div class="racks-container ${containerClass}">
            `;

            block.aisles.forEach(aisle => {
                const totalKilos = calcTotalKilos(aisle.items);
                const pallets = totalKilos / 600;
                const roundedPallets = parseFloat(pallets.toFixed(1));

                totalGlobalFilled += roundedPallets;

                const occupancyRate = (roundedPallets / aisle.capacity) * 100;
                const heatClass = getHeatmapClass(occupancyRate);

                blockHtml += `
                    <div class="rack animate-rack ${heatClass} aisle-unit"
                         data-id="${aisle.id}"
                         title="Pasillo ${aisle.id}: ${roundedPallets} palets est.">
                        <span class="rack-id">P${aisle.id}</span>
                        <span class="aisle-badge">${roundedPallets} pal.</span>
                    </div>
                `;
            });

            blockHtml += `</div>`;
            blockEl.innerHTML = blockHtml;
            colEl.appendChild(blockEl);
        });

        gridEl.appendChild(colEl);
    });

    updateGlobalMetrics(totalGlobalFilled, totalGlobalCapacity);

    // FIX: solo adjuntamos listeners de pasillo (el global ya está registrado una vez)
    attachAisleListeners();
}

function updateGlobalMetrics(filled, total) {
    const rate = total === 0 ? 0 : (filled / total) * 100;
    const globalCountEl = document.getElementById('global-ocupation');
    const globalProgressEl = document.getElementById('global-progress');

    globalCountEl.textContent = `${Math.round(rate)}%`;
    globalProgressEl.style.width = `${Math.min(rate, 100)}%`;

    const color = getHeatmapColorHex(rate);
    globalCountEl.style.color = color;
    globalProgressEl.style.backgroundColor = color;
}

function attachAisleListeners() {
    const aislesUnits = document.querySelectorAll('.aisle-unit');

    aislesUnits.forEach(aisleEl => {
        // FIX: clonar para eliminar listeners previos sin acumularlos
        const clone = aisleEl.cloneNode(true);
        aisleEl.parentNode.replaceChild(clone, aisleEl);

        clone.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.aisle-unit.active').forEach(el => el.classList.remove('active'));
            clone.classList.add('active');

            const aisleId = clone.getAttribute('data-id');
            const aisleData = allAislesData[aisleId];
            if (aisleData) showInspector(aisleData);
        });
    });

    // FIX: listener global registrado solo UNA vez en toda la vida del app
    if (!globalClickListenerAttached) {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.aisle-unit') && !e.target.closest('#inspector-panel')) {
                closeInspector();
            }
        });
        globalClickListenerAttached = true;
    }
}

function closeInspector() {
    const inspector = document.getElementById('inspector-panel');
    inspector.classList.remove('visible');
    document.querySelectorAll('.aisle-unit.active').forEach(el => el.classList.remove('active'));
}

function showInspector(aisleData) {
    const inspector = document.getElementById('inspector-panel');

    // FIX: limpiar clases acumuladas y reasignar limpiamente
    inspector.className = 'inspector-panel wide-panel';

    const totalKilos = calcTotalKilos(aisleData.items);
    const pallets = totalKilos / 600;
    const roundedPallets = parseFloat(pallets.toFixed(1));
    const occupancyRate = (roundedPallets / aisleData.capacity) * 100;
    const heatColor = getHeatmapColorHex(occupancyRate);

    // FIX: itemCount definida correctamente (era la variable indefinida que rompía todo)
    const itemCount = aisleData.items ? aisleData.items.length : 0;

    let content = `
        <div class="inspector-header">
            <div>
                <h3 style="font-size:22px; color:var(--accent);">Pasillo ${aisleData.id}</h3>
                <span style="background:${heatColor}33; color:${heatColor}; display:inline-block; margin-top:6px;
                             padding:3px 10px; border-radius:6px; font-size:13px; font-weight:600;">
                    Ocupación: ${Math.round(occupancyRate)}% &nbsp;·&nbsp; ${roundedPallets} / ${aisleData.capacity} palets
                </span>
            </div>
            <button class="close-inspector" onclick="closeInspector()">
                <i class="ri-close-line"></i>
            </button>
        </div>
        <div class="items-list-container">
    `;

    if (itemCount > 0) {
        // Agrupar items por código de referencia
        const groupedItems = {};
        aisleData.items.forEach(item => {
            if (!groupedItems[item.id]) {
                groupedItems[item.id] = { ...item, count: 0, totalKilos: 0, totalHojas: 0 };
            }
            groupedItems[item.id].count++;
            // FIX: ignorar kilos/hojas negativos al agrupar también
            groupedItems[item.id].totalKilos += Math.max(0, item.kilos || 0);
            groupedItems[item.id].totalHojas += Math.max(0, item.hojas || 0);
        });

        const groups = Object.values(groupedItems).sort((a, b) => b.totalKilos - a.totalKilos);

        content += `
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Ref./Código</th>
                        <th>Descripción</th>
                        <th style="text-align:right">Hojas</th>
                        <th style="text-align:right">Kilos</th>
                        <th style="text-align:center">Palets Est.</th>
                    </tr>
                </thead>
                <tbody>
        `;

        groups.forEach(group => {
            const paletsEst = (group.totalKilos / 600).toFixed(1);
            content += `
                <tr>
                    <td style="color:var(--accent); font-weight:600; font-size:11px; white-space:nowrap;">${group.id}</td>
                    <td style="font-size:11px; max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                        title="${group.tipo}">${group.tipo}</td>
                    <td style="text-align:right; font-family:monospace; font-size:12px;">${group.totalHojas.toLocaleString('es-ES')}</td>
                    <td style="text-align:right; font-family:monospace; font-size:12px; color:#a1a1aa;">${group.totalKilos.toLocaleString('es-ES')} kg</td>
                    <td style="text-align:center;">
                        <span style="background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:12px; font-size:11px;">${paletsEst}</span>
                    </td>
                </tr>
            `;
        });

        content += `</tbody></table>`;
    } else {
        content += `
            <div style="text-align:center; padding:40px 0; color:var(--text-muted)">
                <i class="ri-delete-bin-3-line" style="font-size:32px; color:var(--heat-empty);"></i>
                <p style="margin-top:12px; font-size:16px;">Pasillo Vacío</p>
                <p style="font-size:13px; margin-top:6px;">No hay ningún artículo registrado en este pasillo.</p>
            </div>
        `;
    }

    content += `</div>`;
    inspector.innerHTML = content;
    inspector.classList.add('visible');
}

// ─── BÚSQUEDA ─────────────────────────────────────────────────────────────────
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();

        if (!query) {
            // Sin búsqueda: restaurar todos los pasillos a estado normal
            document.querySelectorAll('.aisle-unit').forEach(el => {
                el.style.opacity = '1';
                el.style.outline = '';
            });
            return;
        }

        // Encontrar pasillos con coincidencias en sus items
        const matchingAisles = new Set();
        Object.values(allAislesData).forEach(aisle => {
            if (!aisle.items) return;
            // Coincidencia también por número de pasillo
            const aisleIdMatch = aisle.id.toLowerCase().includes(query);
            const itemsMatch = aisle.items.some(item =>
                (item.id && item.id.toLowerCase().includes(query)) ||
                (item.tipo && item.tipo.toLowerCase().includes(query)) ||
                (item.gramaje && item.gramaje.toLowerCase().includes(query)) ||
                (item.proveedor && item.proveedor.toLowerCase().includes(query))
            );
            if (aisleIdMatch || itemsMatch) matchingAisles.add(aisle.id);
        });

        // Resaltar coincidencias / atenuar el resto
        document.querySelectorAll('.aisle-unit').forEach(el => {
            const id = el.getAttribute('data-id');
            if (matchingAisles.has(id)) {
                el.style.opacity = '1';
                el.style.outline = '2px solid var(--accent)';
                el.style.outlineOffset = '2px';
            } else {
                el.style.opacity = '0.2';
                el.style.outline = '';
            }
        });

        // Si solo hay un resultado, abrir su inspector automáticamente
        if (matchingAisles.size === 1) {
            const [singleId] = matchingAisles;
            const el = document.querySelector(`.aisle-unit[data-id="${singleId}"]`);
            if (el) {
                document.querySelectorAll('.aisle-unit.active').forEach(a => a.classList.remove('active'));
                el.classList.add('active');
            }
            showInspector(allAislesData[singleId]);
        }
    });

    // Limpiar con Escape
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
            closeInspector();
        }
    });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await initMockData();
    renderWarehouse();
    setupSearch();

    if (window.firebaseDb) {
        const statusInd = document.querySelector('.status-indicator');
        statusInd.textContent = 'Conectando a Firestore...';

        const db = window.firebaseDb;
        const colRef = window.firebaseCollection(db, 'almacen');

        const forceBtn = document.getElementById('force-sync-btn');
        if (forceBtn) {
            forceBtn.addEventListener('click', async () => {
                const conf = confirm(
                    "¿Estás seguro de forzar la sobreescritura de TODOS los pasillos en la Nube con los datos base de seed.json?\n\nEsto borrará cualquier cambio hecho a mano en Firebase."
                );
                if (!conf) return;

                statusInd.textContent = 'Forzando Recarga...';
                forceBtn.disabled = true;
                try {
                    const promises = [];
                    for (let aId in allAislesData) {
                        const docRef = window.firebaseDoc(db, 'almacen', aId);
                        const excelItems = localSeedData[aId] ? localSeedData[aId].items : [];
                        promises.push(window.firebaseSetDoc(docRef, { items: excelItems }));
                    }
                    await Promise.all(promises);
                    alert("¡Sincronización completada con éxito!");
                    statusInd.textContent = 'En vivo (Firestore)';
                } catch(e) {
                    alert("Error al sincronizar: " + e.message);
                    statusInd.textContent = 'Error Firestore';
                }
                forceBtn.disabled = false;
            });
        }

        let isFirstLoad = true;

        window.firebaseOnSnapshot(colRef, (snapshot) => {
            if (snapshot.empty && isFirstLoad && window.firebaseSetDoc) {
                console.log("Colección vacía. Sembrando con datos del Excel...");
                statusInd.textContent = 'Volcando Excel a Base de Datos...';

                const promises = [];
                for (let aId in allAislesData) {
                    const docRef = window.firebaseDoc(db, 'almacen', aId);
                    promises.push(window.firebaseSetDoc(docRef, {
                        items: allAislesData[aId].items || []
                    }));
                }
                Promise.all(promises)
                    .then(() => console.log("Datos sembrados con éxito."))
                    .catch(e => console.error("Error al poblar Firestore:", e));

            } else if (!snapshot.empty) {
                snapshot.forEach(docSnap => {
                    const aisleId = docSnap.id;
                    const data = docSnap.data();
                    if (allAislesData[aisleId]) {
                        allAislesData[aisleId].items = Array.isArray(data.items) ? data.items : [];
                    }
                });

                statusInd.textContent = 'En vivo (Firestore)';
                renderWarehouse();

                // Refrescar inspector si estaba abierto
                const activeAisle = document.querySelector('.aisle-unit.active');
                if (activeAisle) {
                    const id = activeAisle.getAttribute('data-id');
                    if (allAislesData[id]) showInspector(allAislesData[id]);
                }
            }

            isFirstLoad = false;

        }, (error) => {
            console.error("Error al escuchar Firestore:", error);
            statusInd.textContent = 'Error Firestore (Usando Local)';
        });
    }
});