const mockPaperTypes = [
    { type: 'Estucado Brillo', gramaje: '135g', marca: 'Creator' },
    { type: 'Offset Blanco', gramaje: '90g', marca: 'Soporset' },
    { type: 'Cartulina Gráfica', gramaje: '300g', marca: 'Invercote' },
    { type: 'Estucado Mate', gramaje: '150g', marca: 'Garda' }
];

// Layout mapping based on the drawing provided:
// 3 Columns. Left is empty at top, starts at 81 down to 76.
// Center has 43-55 top, 63-75 bottom.
// Right has 1-17 top, 18-42 bottom.
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

const allRacksData = {};
let totalCapacity = 0;

function initMockData() {
    WAREHOUSE_LAYOUT.forEach(col => {
        col.blocks.forEach(block => {
            if (block.type === 'empty') return;
            const racks = [];
            const isAsc = block.start <= block.end;
            const step = isAsc ? 1 : -1;
            
            for (let i = block.start; isAsc ? i <= block.end : i >= block.end; i += step) {
                const isOccupied = Math.random() > 0.3; // 70% chance of occupied
                let itemData = null;

                if (isOccupied) {
                    const randomType = mockPaperTypes[Math.floor(Math.random() * mockPaperTypes.length)];
                    itemData = {
                        id: `BOB-${Math.floor(Math.random() * 90000) + 10000}`,
                        tipo: randomType.type,
                        gramaje: randomType.gramaje,
                        proveedor: randomType.marca,
                        kilos: Math.floor(Math.random() * 800) + 200 + ' kg',
                        fecha_entrada: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toLocaleDateString()
                    };
                }

                const rackObj = {
                    position: String(i).padStart(2, '0'),
                    isOccupied,
                    item: itemData,
                    blockId: block.id
                };

                racks.push(rackObj);
                allRacksData[rackObj.position] = rackObj;
                totalCapacity++;
            }
            block.racks = racks;
            block.capacity = racks.length;
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
    
    let totalFilled = 0;

    WAREHOUSE_LAYOUT.forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'layout-column';

        col.blocks.forEach(block => {
            const blockEl = document.createElement('div');
            
            if (block.type === 'empty') {
                blockEl.className = 'layout-block empty-block';
                // Spacer height corresponding to roughly 17 racks (N1 right side height)
                blockEl.style.minHeight = '600px'; 
                colEl.appendChild(blockEl);
                return;
            }

            const filledInBlock = block.racks.filter(r => r.isOccupied).length;
            totalFilled += filledInBlock;
            const occupancyRate = (filledInBlock / block.capacity) * 100;
            const heatColor = getHeatmapColorHex(occupancyRate);

            blockEl.className = 'layout-block';
            blockEl.innerHTML = `
                <div class="aisle-header">
                    <span class="aisle-title">${block.name}</span>
                    <span class="aisle-capacity" style="background: ${heatColor}33; color: ${heatColor}">
                        ${Math.round(occupancyRate)}% (${filledInBlock}/${block.capacity})
                    </span>
                </div>
                <div class="racks-container single-col">
                    ${block.racks.map(rack => `
                        <div class="rack animate-rack ${rack.isOccupied ? 'full' : 'empty'}" 
                             data-pos="${rack.position}"
                             title="Hueco: ${rack.position}">
                            <span class="rack-id">${rack.position}</span>
                        </div>
                    `).join('')}
                </div>
            `;
            colEl.appendChild(blockEl);
        });

        gridEl.appendChild(colEl);
    });

    updateGlobalMetrics(totalFilled, totalCapacity);
    attachRackListeners();
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

function attachRackListeners() {
    const racks = document.querySelectorAll('.rack');
    const inspector = document.getElementById('inspector-panel');

    racks.forEach(rackEl => {
        rackEl.addEventListener('mouseenter', (e) => {
            const pos = e.currentTarget.getAttribute('data-pos');
            const rackData = allRacksData[pos];
            if (rackData) showInspector(rackData);
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.rack') && !e.target.closest('.inspector-panel')) {
            inspector.classList.remove('visible');
        }
    });
}

function showInspector(rackData) {
    const inspector = document.getElementById('inspector-panel');
    
    let content = `
        <div class="inspector-header">
            <h3>Hueco ${rackData.position}</h3>
            <button class="close-inspector" onclick="document.getElementById('inspector-panel').classList.remove('visible')">
                <i class="ri-close-line"></i>
            </button>
        </div>
    `;

    if (rackData.isOccupied && rackData.item) {
        content += `
            <div class="item-detail">
                <span class="item-label">Lote / Registro</span>
                <span class="item-value" style="color:var(--accent)">${rackData.item.id}</span>
            </div>
            <div class="item-detail">
                <span class="item-label">Tipo</span>
                <span class="item-value">${rackData.item.tipo}</span>
            </div>
            <div class="item-detail">
                <span class="item-label">Gramaje</span>
                <span class="item-value">${rackData.item.gramaje}</span>
            </div>
            <div class="item-detail">
                <span class="item-label">Marca</span>
                <span class="item-value">${rackData.item.proveedor}</span>
            </div>
            <div class="item-detail">
                <span class="item-label">Peso aprox.</span>
                <span class="item-value">${rackData.item.kilos}</span>
            </div>
            <div class="item-detail">
                <span class="item-label">Fecha Alta</span>
                <span class="item-value">${rackData.item.fecha_entrada}</span>
            </div>
        `;
    } else {
        content += `
            <div style="text-align:center; padding: 20px 0; color: var(--text-muted)">
                <i class="ri-checkbox-blank-circle-line" style="font-size: 24px; color: var(--heat-empty);"></i>
                <p style="margin-top: 8px;">Ubicación Libre</p>
                <p style="font-size: 12px; margin-top: 4px;">Lista para alojar entrada</p>
            </div>
        `;
    }

    inspector.innerHTML = content;
    inspector.classList.add('visible');
}

document.addEventListener('DOMContentLoaded', () => {
    initMockData();
    renderWarehouse();
    
    // Simulate real-time updates for that WOW factor
    setInterval(() => {
        const positions = Object.keys(allRacksData);
        if (positions.length === 0) return;

        const randomPos = positions[Math.floor(Math.random() * positions.length)];
        const rack = allRacksData[randomPos];
        
        if (rack.isOccupied) {
            rack.isOccupied = false;
            rack.item = null;
        } else {
            rack.isOccupied = true;
            const randomType = mockPaperTypes[Math.floor(Math.random() * mockPaperTypes.length)];
            rack.item = {
                id: `BOB-${Math.floor(Math.random() * 90000) + 10000}`,
                tipo: randomType.type,
                gramaje: randomType.gramaje,
                proveedor: randomType.marca,
                kilos: Math.floor(Math.random() * 800) + 200 + ' kg',
                fecha_entrada: new Date().toLocaleDateString()
            };
        }

        renderWarehouse();
    }, 4500);
});
