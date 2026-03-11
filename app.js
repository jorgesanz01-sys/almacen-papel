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
            { id: 'empty-top', type: 'empty' },
            { id: 'nave2-izq', name: 'N2 Izquierdo', start: 81, end: 76 }
        ]
    },
    {
        id: 'col-center',
        blocks: [
            { id: 'nave1-izq', name: 'N1 Izquierdo', start: 43, end: 55 },
            { id: 'nave2-cen', name: 'N2 Central', start: 63, end: 75 }
        ]
    },
    {
        id: 'col-right',
        blocks: [
            { id: 'nave1-der', name: 'N1 Derecho', start: 1, end: 17 },
            { id: 'nave2-der', name: 'N2 Derecho', start: 18, end: 42 }
        ]
    }
];

// Global state mapping Aisle ID -> { id, capacity, items: [] }
const allAislesData = {};
let totalGlobalCapacity = 0;

function initMockData() {
    WAREHOUSE_LAYOUT.forEach(col => {
        col.blocks.forEach(block => {
            if (block.type === 'empty') return;
            const aislesList = [];
            const isAsc = block.start <= block.end;
            const step = isAsc ? 1 : -1;
            
            for (let i = block.start; isAsc ? i <= block.end : i >= block.end; i += step) {
                const aisleId = String(i).padStart(2, '0');
                const maxCapacity = 20; // Default capacity per aisle for visualization
                const items = [];
                
                // Randomly assign items to the aisle
                const itemCount = Math.floor(Math.random() * (maxCapacity + 1));
                
                for(let j=0; j<itemCount; j++) {
                    const randomType = mockPaperTypes[Math.floor(Math.random() * mockPaperTypes.length)];
                    items.push({
                        id: `BOB-${Math.floor(Math.random() * 90000) + 10000}`,
                        tipo: randomType.type,
                        gramaje: randomType.gramaje,
                        proveedor: randomType.marca,
                        kilos: Math.floor(Math.random() * 800) + 200,
                        fecha_entrada: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toLocaleDateString()
                    });
                }

                const aisleObj = {
                    id: aisleId,
                    capacity: maxCapacity,
                    items: items,
                    blockId: block.id
                };

                aislesList.push(aisleObj);
                allAislesData[aisleId] = aisleObj;
                totalGlobalCapacity += maxCapacity;
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
            let blockHtml = `
                <div class="aisle-header">
                    <span class="aisle-title">${block.name}</span>
                </div>
                <div class="racks-container single-col">
            `;

            block.aisles.forEach(aisle => {
                const itemCount = aisle.items ? aisle.items.length : 0;
                totalGlobalFilled += itemCount;
                
                const occupancyRate = (itemCount / aisle.capacity) * 100;
                const heatClass = getHeatmapClass(occupancyRate);
                
                blockHtml += `
                    <div class="rack animate-rack ${heatClass} aisle-unit" 
                         data-id="${aisle.id}"
                         title="Pasillo ${aisle.id}: ${itemCount} artículos">
                        <span class="rack-id" style="font-size: 14px; font-weight: bold;">P${aisle.id}</span>
                        <span class="aisle-badge">${itemCount} items</span>
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
    
    const itemCount = aisleData.items ? aisleData.items.length : 0;
    const occupancyRate = (itemCount / aisleData.capacity) * 100;
    const heatColor = getHeatmapColorHex(occupancyRate);
    
    let content = `
        <div class="inspector-header">
            <div>
                <h3 style="font-size: 24px; color: var(--accent);">Pasillo ${aisleData.id}</h3>
                <span class="aisle-capacity" style="background: ${heatColor}33; color: ${heatColor}; display: inline-block; margin-top: 8px;">
                    Ocupación: ${Math.round(occupancyRate)}% (${itemCount}/${aisleData.capacity})
                </span>
            </div>
            <button class="close-inspector" onclick="document.getElementById('inspector-panel').classList.remove('visible'); document.querySelectorAll('.aisle-unit.active').forEach(el => el.classList.remove('active'));">
                <i class="ri-close-line"></i>
            </button>
        </div>
        
        <div class="items-list-container">
    `;

    if (itemCount > 0) {
        // Render a list/table of items
        content += `<table class="items-table">
            <thead>
                <tr>
                    <th>Lote</th>
                    <th>Tipo</th>
                    <th>Gramaje</th>
                    <th>Marca</th>
                    <th>Peso</th>
                </tr>
            </thead>
            <tbody>`;
            
        aisleData.items.forEach(item => {
            content += `
                <tr>
                    <td style="color:var(--accent); font-weight: 500;">${item.id}</td>
                    <td>${item.tipo}</td>
                    <td>${item.gramaje}</td>
                    <td>${item.proveedor}</td>
                    <td>${item.kilos} kg</td>
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

document.addEventListener('DOMContentLoaded', () => {
    initMockData();
    renderWarehouse();
    
    // Check if Firestore is available
    if (window.firebaseDb) {
        const statusInd = document.querySelector('.status-indicator');
        statusInd.textContent = 'Conectando a Firestore...';
        
        const db = window.firebaseDb;
        const colRef = window.firebaseCollection(db, 'almacen');
        
        let isFirstLoad = true;
        
        window.firebaseOnSnapshot(colRef, (snapshot) => {
            if (snapshot.empty && isFirstLoad && window.firebaseSetDoc) {
                // Database is completely empty. Let's auto-seed it with our mock data
                console.log("Colección de Firestore vacía. Sembrando con datos iniciales...");
                
                let promises = [];
                for (let aId in allAislesData) {
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
