import pandas as pd
import json
import re
import sys

# Usage: python process_excel.py [filename]
file_path = sys.argv[1] if len(sys.argv) > 1 else "inventario.xls"

try:
    df = pd.read_excel(file_path, skiprows=5)
    cols = df.columns.tolist()

    # Columnas reales del Excel in2:
    # [0] Codigo   [3] Proveedor   [6] P.Costo (ubicacion "C28 lote:1")
    # [9] Cantidad (Kg si unidad es Kg, Pliegos si unidad es Pl)
    # [10] Unidad ("Kg" o "Pl")
    # [12] Kilos totales
    COL_COD   = cols[0]
    COL_PROV  = cols[3]
    COL_UBI   = cols[6]
    COL_CANT  = cols[9]   # cantidad en la unidad indicada en col 10
    COL_UNIT  = cols[10]  # "Kg" o "Pl"
    COL_KG    = cols[12]  # kilos

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

    def safe_float(val):
        try:
            v = float(val)
            return 0 if (v != v) else v  # isnan check
        except:
            return 0

    aisles_data = {}
    imported = 0
    ignored = 0

    for _, row in df.iterrows():
        codigo = str(row[COL_COD]).strip()
        if not codigo or codigo.lower() in ['nan', 'codigo', 'total listado', 'valor ubicaciones']:
            continue
        if 'e-' in codigo.lower() or 'criterio' in codigo.lower():
            continue

        aisle_id = get_aisle_id(row[COL_UBI])
        if not aisle_id:
            ignored += 1
            continue

        if aisle_id not in aisles_data:
            aisles_data[aisle_id] = {'items': []}

        prov = str(row[COL_PROV]).strip()
        if prov.lower() == 'nan': prov = ''

        cant  = safe_float(row[COL_CANT])
        kg    = safe_float(row[COL_KG])
        unit  = str(row[COL_UNIT]).strip().lower()

        # Si unidad es "pl" la cantidad son pliegos, si es "kg" son kilos
        if unit == 'pl':
            hojas = int(cant)
            kilos = int(kg)
        else:
            hojas = 0
            kilos = int(cant) if cant > 0 else int(kg)

        gramaje = extract_gramaje(codigo)
        tipo = prov if len(prov) > 5 else (codigo[:30] if codigo else 'Papel')

        aisles_data[aisle_id]['items'].append({
            'id':       codigo,
            'tipo':     tipo[:80],
            'gramaje':  gramaje,
            'proveedor': prov.split()[0] if prov else '-',
            'kilos':    kilos,
            'hojas':    hojas,
            'fecha_entrada': 'Sincronizado Excel'
        })
        imported += 1

    with open('seed.json', 'w', encoding='utf-8') as f:
        json.dump(aisles_data, f, ensure_ascii=False, indent=2)

    print(f'Extraccion Completada:')
    print(f'  - {len(aisles_data)} pasillos/zonas importados')
    print(f'  - {imported} referencias importadas')
    print(f'  - {ignored} filas ignoradas')
    print(f'  - C28 ({len(aisles_data.get("28",{}).get("items",[]))} refs):')
    for it in list(aisles_data.get('28', {}).get('items', []))[:5]:
        print(f'      {it["id"]}: hojas={it["hojas"]}, kilos={it["kilos"]}')

except Exception as e:
    import traceback
    print(f'Error: {e}')
    traceback.print_exc()
