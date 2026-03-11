// app.js - Refactored for entire Aisle occupancy logic
const mockPaperTypes = [
    { type: 'Estucado Brillo', gramaje: '135g', marca: 'Creator' },
    { type: 'Offset Blanco', gramaje: '90g', marca: 'Soporset' },
    { type: 'Cartulina Gráfica', gramaje: '300g', marca: 'Invercote' },
    { type: 'Estucado Mate', gramaje: '150g', marca: 'Garda' }
];

// Map layout. Aisles are the atomic units now, not bins.
// We give each aisle a 'capacity' (e.g., max number of items it can hold, purely logical for now)
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

// Global state mapping Aisle ID -> { id, capacity, items: [] }
const allAislesData = {};
let totalGlobalCapacity = 0;
let localSeedData = {};


async function initMockData() {
    try {
        const resp = await fetch('./seed.json');
        if (resp.ok) {
            localSeedData = await resp.json();
            console.log("Cargados datos base de seed.json");
        }
    } catch(e) { console.log("No seed.json found", e); }

    WAREHOUSE_LAYOUT.forEach(col => {
        col.blocks.forEach(block => {
            if (block.type === 'empty') return;
            const aislesList = [];
            
            if (block.isExternal) {
                const aisleId = block.extId;
                const maxCapacity = 500; // Arbitrary large capacity for externals
                const items = localSeedData[aisleId] ? localSeedData[aisleId].items : [];
                
                const aisleObj = { id: aisleId, capacity: maxCapacity, items: items, blockId: block.id };
                aislesList.push(aisleObj);
                allAislesData[aisleId] = aisleObj;
                totalGlobalCapacity += maxCapacity;
            } else {
                const isAsc = block.start <= block.end;
                const step = isAsc ? 1 : -1;
                
                for (let i = block.start; isAsc ? i <= block.end : i >= block.end; i += step) {
                    const aisleId = String(i).padStart(2, '0');
                    const maxCapacity = 24; // Default 24 palets per aisle
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
                let totalKilos = 0;
                if (aisle.items) {
                    aisle.items.forEach(it => totalKilos += (it.kilos || 0));
                }
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
                        <span class="aisle-badge">${roundedPallets} palets</span>
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
    attachAisleListeners();
}

function updateGlobalMetrics(filled, total) {
    const rate = total === 0 ? 0 : (filled / total) * 100;
    const globalCountEl = document.getElementById('global-ocupation');
    const globalProgressEl = document.getElementById('global-progress');
    
    globalCountEl.textContent = `${Math.round(rate)}%`;
    globalProgressEl.style.width = `${rate}%`;
    
    const color = getHeatmapColorHex(rate);
    globalCountEl.style.color = color;
    globalProgressEl.style.backgroundColor = color;
}

function attachAisleListeners() {
    const aislesUnits = document.querySelectorAll('.aisle-unit');
    const inspector = document.getElementById('inspector-panel');

    aislesUnits.forEach(aisleEl => {
        aisleEl.addEventListener('click', (e) => {
            // Stop propagation to avoid immediate closing by global document click
            e.stopPropagation();
            
            // Remove active class from all
            document.querySelectorAll('.aisle-unit.active').forEach(el => el.classList.remove('active'));
            
            // Add active to current
            e.currentTarget.classList.add('active');
            
            const aisleId = e.currentTarget.getAttribute('data-id');
            const aisleData = allAislesData[aisleId];
            if (aisleData) showInspector(aisleData);
        });
    });

    // We can also click to pin the inspector
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.aisle-unit') && !e.target.closest('.inspector-panel')) {
            inspector.classList.remove('visible');
            document.querySelectorAll('.aisle-unit.active').forEach(el => el.classList.remove('active'));
        }
    });
}

function showInspector(aisleData) {
    const inspector = document.getElementById('inspector-panel');
    inspector.classList.add('wide-panel'); // We'll make it wider in CSS for list view
    
    let totalKilos = 0;
    if (aisleData.items) {
        aisleData.items.forEach(it => totalKilos += (it.kilos || 0));
    }
    const pallets = totalKilos / 600;
    const roundedPallets = parseFloat(pallets.toFixed(1));

    const occupancyRate = (roundedPallets / aisleData.capacity) * 100;
    const heatColor = getHeatmapColorHex(occupancyRate);
    
    let content = `
        <div class="inspector-header">
            <div>
                <h3 style="font-size: 24px; color: var(--accent);">Pasillo ${aisleData.id}</h3>
                <span class="aisle-capacity" style="background: ${heatColor}33; color: ${heatColor}; display: inline-block; margin-top: 8px;">
                    Ocupación: ${Math.round(occupancyRate)}% (${roundedPallets}/${aisleData.capacity} palets)
                </span>
            </div>
            <button class="close-inspector" onclick="document.getElementById('inspector-panel').classList.remove('visible'); document.querySelectorAll('.aisle-unit.active').forEach(el => el.classList.remove('active'));">
                <i class="ri-close-line"></i>
            </button>
        </div>
        
        <div class="items-list-container">
    `;

    if (itemCount > 0) {
        // Group items by code
        const groupedItems = {};
        aisleData.items.forEach(item => {
            if (!groupedItems[item.id]) {
                groupedItems[item.id] = {
                    ...item,
                    count: 0,
                    totalKilos: 0,
                    totalHojas: 0
                };
            }
            groupedItems[item.id].count++;
            groupedItems[item.id].totalKilos += (item.kilos || 0);
            groupedItems[item.id].totalHojas += (item.hojas || 0);
        });

        const groups = Object.values(groupedItems);
        // Sort groups by total kilos descending
        groups.sort((a,b) => b.totalKilos - a.totalKilos);

        content += `<table class="items-table">
            <thead>
                <tr>
                    <th>Ref./Código</th>
                    <th>Descripción</th>
                    <th style="text-align:right">Hojas</th>
                    <th style="text-align:right">Kilos</th>
                    <th style="text-align:center">Palets Est.</th>
                </tr>
            </thead>
            <tbody>`;
            
        groups.forEach(group => {
            const paletsEst = (group.totalKilos / 600).toFixed(1);
            
            content += `
                <tr>
                    <td style="color:var(--accent); font-weight: 600; font-size: 12px;">${group.id}</td>
                    <td style="font-size: 11px; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${group.tipo}">${group.tipo}</td>
                    <td style="text-align:right; font-family: monospace;">${group.totalHojas.toLocaleString()}</td>
                    <td style="text-align:right; font-family: monospace; color: #a1a1aa;">${group.totalKilos.toLocaleString()} kg</td>
                    <td style="text-align:center;">
                        <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 12px; font-size: 11px;">
                            ${paletsEst}
                        </span>
                    </td>
                </tr>
            `;
        });
        
        content += `</tbody></table>`;
    } else {
        content += `
            <div style="text-align:center; padding: 40px 0; color: var(--text-muted)">
                <i class="ri-delete-bin-3-line" style="font-size: 32px; color: var(--heat-empty);"></i>
                <p style="margin-top: 12px; font-size: 16px;">Pasillo Vacío</p>
                <p style="font-size: 13px; margin-top: 6px;">No hay ningún artículo registrado en este pasillo.</p>
            </div>
        `;
    }

    content += `</div>`;
    inspector.innerHTML = content;
    inspector.classList.add('visible');
}

document.addEventListener('DOMContentLoaded', async () => {
    await initMockData();
    renderWarehouse();
    
    // Check if Firestore is available
    if (window.firebaseDb) {
        const statusInd = document.querySelector('.status-indicator');
        statusInd.textContent = 'Conectando a Firestore...';
        
        const db = window.firebaseDb;
        const colRef = window.firebaseCollection(db, 'almacen');
        
        // Setup Force Sync button
        const forceBtn = document.getElementById('force-sync-btn');
        if(forceBtn) {
            forceBtn.addEventListener('click', async () => {
                const conf = confirm("¿Estás seguro de forzar la sobreescritura de TODOS los pasillos en la Nube con los datos base de tu último Excel (seed.json)? \n\nEsto borrará cualquier cambio hecho a mano en Firebase.");
                if(conf) {
                    statusInd.textContent = 'Forzando Recarga...';
                    forceBtn.disabled = true;
                    try {
                        let promises = [];
                        for (let aId in allAislesData) {
                            const docRef = window.firebaseDoc(db, 'almacen', aId);
                            const excelItems = localSeedData[aId] ? localSeedData[aId].items : [];
                            promises.push(window.firebaseSetDoc(docRef, {
                                items: excelItems
                            }));
                        }
                        await Promise.all(promises);
                        alert("¡Sincronización completada con éxito!");
                        statusInd.textContent = 'En vivo (Firestore)';
                    } catch(e) {
                        alert("Error al sincronizar: " + e.message);
                        statusInd.textContent = 'Error Firestore';
                    }
                    forceBtn.disabled = false;
                }
            });
        }
        
        let isFirstLoad = true;
        
        window.firebaseOnSnapshot(colRef, (snapshot) => {
            if (snapshot.empty && isFirstLoad && window.firebaseSetDoc) {
                // Database is completely empty. Let's auto-seed it with our excel data
                console.log("Colección de Firestore vacía. Sembrando con datos del Excel...");
                statusInd.textContent = 'Volcando Excel a Base de Datos...';
                
                let promises = [];
                for (let aId in allAislesData) {
                    // Only dump aisles that actually have items, to save quota and speed things up!
                    // Wait, no, we might want empty aisles so they are ready
                    const docRef = window.firebaseDoc(db, 'almacen', aId);
                    promises.push(window.firebaseSetDoc(docRef, {
                        items: allAislesData[aId].items || []
                    }));
                }
                
                Promise.all(promises)
                    .then(() => console.log("Datos sembrados con éxito. ¡Todo listo!"))
                    .catch(e => console.error("Error al poblar Firestore:", e));
            } else if (!snapshot.empty) {
                // Real data received! Merge it into our local state mapping
                snapshot.forEach(docSnap => {
                    const aisleId = docSnap.id;
                    const data = docSnap.data();
                    
                    if (allAislesData[aisleId]) {
                        const incomingItems = data.items;
                        allAislesData[aisleId].items = Array.isArray(incomingItems) ? incomingItems : [];
                    }
                });
                
                statusInd.textContent = 'En vivo (Firestore)';
                renderWarehouse();
                
                // If inspector is open, refresh it
                const activeAisle = document.querySelector('.aisle-unit.active');
                if (activeAisle) {
                    const id = activeAisle.getAttribute('data-id');
                    showInspector(allAislesData[id]);
                }
            }
            
            isFirstLoad = false;
        }, (error) => {
            console.error("Error al escuchar Firestore:", error);
            statusInd.textContent = 'Error Firestore (Usando Local)';
        });
        
    }
});
