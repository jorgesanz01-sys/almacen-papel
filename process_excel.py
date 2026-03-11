import pandas as pd
import json
import re
import sys

# Usage: python process_excel.py [filename]
file_path = sys.argv[1] if len(sys.argv) > 1 else "inventario.xls"

try:
    df = pd.read_excel(file_path, skiprows=5)
    cols = df.columns.tolist()

    # ── Columnas clave (por índice, el Excel es "sucio") ─────────────────────
    # [0] Codigo   [3] Proveedor/Desc   [6] P.Costo (contiene "C28 lote:1")
    # [8] Precio unitario   [9] Stock pliegos (solo en fila resumen)
    # [10] Unidad stock (Pl/Kg)   [12] Pliegos totales (solo en fila resumen)
    COL_COD  = cols[0]
    COL_PROV = cols[3]
    COL_UBI  = cols[6]   # "C28             lote:1"
    COL_PRECIO = cols[8]  # precio unitario por pliego (en filas artículo)
    COL_STOCK_PLIEGOS = cols[9]   # stock total en pliegos (solo fila resumen)
    COL_STOCK_KG      = cols[12]  # stock total en kg     (solo fila resumen)

    # ── Función para determinar el ID de ubicación ───────────────────────────
    def get_aisle_id(ubi_raw):
        u = str(ubi_raw).strip().upper()
        if not u or u == 'NAN': return None
        if 'TALLER'  in u: return 'TALLER'
        if 'MONGE'   in u: return 'MONGE'
        if 'DIGITAL' in u: return 'DIGITAL'
        m = re.match(r'^C(\d+)', u)
        if m:
            n = int(m.group(1))
            if 1 <= n <= 99:
                return f'{n:02d}'
        return None

    # ── Función para extraer gramaje del código ──────────────────────────────
    def extract_gramaje(codigo):
        m = re.match(r'^1(\d+)[A-Za-z]', str(codigo))
        if m:
            try:
                n = int(m.group(1))
                if 0 < n < 2000:
                    return f'{n}g'
            except:
                pass
        return '-'

    # ── Primera pasada: agrupar filas por pasillo ────────────────────────────
    # Cada pasillo tiene N filas de artículo + 1 fila resumen con totales
    raw_groups = {}   # aisle_id → { 'articles': [...], 'total_pliegos': 0, 'total_kg': 0 }

    for _, row in df.iterrows():
        codigo = str(row[COL_COD]).strip()
        if not codigo or codigo.lower() in ['nan', 'codigo', 'total listado', 'valor ubicaciones']:
            continue
        if 'e-' in codigo.lower() or 'criterio' in codigo.lower():
            continue

        ubi_raw = row[COL_UBI]
        aisle_id = get_aisle_id(ubi_raw)
        if not aisle_id:
            continue

        if aisle_id not in raw_groups:
            raw_groups[aisle_id] = {'articles': [], 'total_pliegos': 0, 'total_kg': 0}

        # ¿Es fila resumen? → tiene stock en col 9 o col 12
        stock_pl = row[COL_STOCK_PLIEGOS]
        stock_kg = row[COL_STOCK_KG]

        try:
            pl_val = float(stock_pl) if str(stock_pl).strip().lower() not in ['nan', ''] else 0
        except:
            pl_val = 0

        try:
            kg_val = float(stock_kg) if str(stock_kg).strip().lower() not in ['nan', ''] else 0
        except:
            kg_val = 0

        if pl_val > 0 or kg_val > 0:
            # Fila resumen: guardar totales
            raw_groups[aisle_id]['total_pliegos'] += pl_val
            raw_groups[aisle_id]['total_kg']      += kg_val
        else:
            # Fila de artículo individual
            prov = str(row[COL_PROV]).strip()
            if prov.lower() == 'nan': prov = ''

            precio_unit = 0
            try:
                pv = float(row[COL_PRECIO])
                if pv > 0: precio_unit = round(pv, 5)
            except:
                pass

            gramaje = extract_gramaje(codigo)
            tipo_final = prov if len(prov) > 5 else (codigo[:30] if codigo else 'Papel')

            raw_groups[aisle_id]['articles'].append({
                'id':       codigo,
                'tipo':     tipo_final[:80],
                'gramaje':  gramaje,
                'proveedor': prov.split()[0] if prov else '-',
                'precio_unit': precio_unit,   # precio por pliego, para calcular
                'kilos':    0,
                'hojas':    0,    # se rellena abajo con estimación proporcional
                'fecha_entrada': 'Sincronizado Excel'
            })

    # ── Segunda pasada: distribuir totales del resumen entre artículos ───────
    # Si tenemos total_pliegos para el pasillo y cada artículo tiene precio_unit,
    # podemos estimar pliegos por artículo → proporcional al precio (aprox).
    # Si no hay precios, repartir uniformemente.
    aisles_data = {}
    imported_items = 0
    ignored_items  = 0

    for aisle_id, group in raw_groups.items():
        articles  = group['articles']
        total_pl  = group['total_pliegos']
        total_kg  = group['total_kg']

        if not articles:
            ignored_items += 1
            continue

        if total_pl > 0:
            # Distribuir proporcionalmente por precio_unit (artículos más caros = más kg)
            prices = [a['precio_unit'] for a in articles]
            total_price = sum(prices)
            if total_price > 0:
                for a in articles:
                    a['hojas'] = round((a['precio_unit'] / total_price) * total_pl)
                    a['kilos'] = round((a['precio_unit'] / total_price) * total_kg)
            else:
                # Sin precios → repartir uniformemente
                per_article = round(total_pl / len(articles))
                kg_per_article = round(total_kg / len(articles))
                for a in articles:
                    a['hojas'] = per_article
                    a['kilos'] = kg_per_article

        # Limpiar campo auxiliar
        for a in articles:
            del a['precio_unit']

        aisles_data[aisle_id] = {'items': articles}
        imported_items += len(articles)

    # ── Guardar JSON ─────────────────────────────────────────────────────────
    with open("seed.json", "w", encoding='utf-8') as f:
        json.dump(aisles_data, f, ensure_ascii=False, indent=2)

    print(f"Extraccion Completada:")
    print(f"   - {len(aisles_data)} pasillos/zonas importados")
    print(f"   - {imported_items} referencias/articulos")
    print(f"   - {ignored_items} pasillos ignorados")
    print(f"   - Ejemplo C28: {len(aisles_data.get('28', {}).get('items', []))} articulos")
    if '28' in aisles_data:
        for item in aisles_data['28']['items'][:3]:
            print(f"     {item['id']}: hojas={item['hojas']}, kilos={item['kilos']}")

except Exception as e:
    import traceback
    print(f"Error: {e}")
    traceback.print_exc()
