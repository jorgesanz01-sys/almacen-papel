import pandas as pd
import json
import re
import math
import sys

# Define locations to track
VALID_AISLES = {f"{i:02d}" for i in range(1, 77)} # '01' to '076'
VALID_ZONES = {"DIGITAL", "TALLER", "MONGE"}

# Usage: python process_excel.py [filename]
file_path = sys.argv[1] if len(sys.argv) > 1 else "inventario.xls"

try:
    # La cabecera útil suele empezar tras las primeras filas de metadatos (skiprows=5)
    df = pd.read_excel(file_path, skiprows=5)
    cols = df.columns.tolist()
    
    aisles_data = {}
    
    # Identificar columnas por índice relativo dado lo sucio del Excel
    col_codigo = cols[0]
    col_desc   = cols[1]
    col_prov   = cols[3] if len(cols) > 3 else None
    col_ubi    = cols[6] if len(cols) > 6 else None # 'Unnamed: 5' o 'P.Costo' suele tener los "C27 lote:1"
    
    # Buscar dinámicamente la columna de stock y peso
    col_stock  = next((c for c in cols if "stock" in str(c).lower()), cols[9] if len(cols) > 9 else None)
    col_peso   = next((c for c in cols if "unnamed: 12" in str(c).lower() or "valor stock" in str(c).lower()), cols[12] if len(cols) > 12 else None)
    
    # Trackers for reporting
    imported_items = 0
    ignored_items = 0

    # Iterar sobre las filas
    for index, row in df.iterrows():
        codigo = str(row.get(col_codigo, "")).strip()
        
        # Ignorar filas basuras
        if not codigo or codigo.lower() in ["nan", "codigo", "total listado", "valor ubicaciones"] or "e-" in codigo.lower() or "criterio" in codigo.lower():
            continue
            
        ubi_raw = str(row.get(col_ubi, "")).strip().upper()
        if pd.isna(row.get(col_ubi)) or "NAN" in ubi_raw:
            ignored_items += 1
            continue
            
        # 1. Determinar ID de ubicación
        aisle_id = None
        
        if "TALLER" in ubi_raw:
            aisle_id = "TALLER"
        elif "MONGE" in ubi_raw:
            aisle_id = "MONGE"
        elif "DIGITAL" in ubi_raw:
            aisle_id = "DIGITAL"
        else:
            # Buscar formato pasillo C1, C44, C99...
            m = re.search(r'^C(\d+)', ubi_raw)
            if m:
                num = int(m.group(1))
                if 1 <= num <= 99:
                    aisle_id = f"{num:02d}"  # Pad "02"
        
        # SÓLO importar si cae en pasillos válidos
        if not aisle_id:
            ignored_items += 1
            continue
            
        if aisle_id not in aisles_data:
            aisles_data[aisle_id] = {"items": []}
            
        desc = str(row.get(col_desc, "")).strip()
        if desc.lower() == "nan": desc = ""
        
        prov = str(row.get(col_prov, "")).strip() if col_prov else ""
        if prov.lower() == "nan": prov = ""
        
        # Extraer peso y stock con limpieza
        peso_val = row.get(col_peso, 0)
        peso = 0
        try:
            if not pd.isna(peso_val):
                peso = round(float(peso_val))
        except:
            pass
            
        hojas = 0
        stock_val = row.get(col_stock, 0)
        try:
            if not pd.isna(stock_val):
                hojas = int(float(stock_val))
        except:
            pass
            
        # Extraer gramaje si falta
        gramaje = "-"
        gm = re.search(r'(\d+)\s*(G|GRS|GR|G/)', prov.upper() + " " + desc.upper())
        if gm:
            gramaje = f"{gm.group(1)}g"
            
        # Determinar el nombre/tipo combinando campos si es necesario
        tipo_final = prov if len(prov) > 5 else desc
        if not tipo_final:
            tipo_final = "Papel Desconocido"
            
        item_obj = {
            "id": codigo,
            "tipo": tipo_final[:80], # No meter nombres ridículamente largos
            "gramaje": gramaje,
            "proveedor": prov.split()[0] if prov else "-",
            "kilos": peso,
            "hojas": hojas,
            "fecha_entrada": "Sincronizado Excel Opc"
        }
        
        aisles_data[aisle_id]["items"].append(item_obj)
        imported_items += 1
        
    # Escribir salida a JSON
    with open("seed.json", "w", encoding='utf-8') as f:
        json.dump(aisles_data, f, ensure_ascii=False, indent=2)
        
    print(f"Extraccion Optimizada Completada:")
    print(f"   - {len(aisles_data.keys())} pasillos/zonas con inventario identificados.")
    print(f"   - {imported_items} lotes/palets importados.")
    print(f"   - {ignored_items} filas ignoradas (ubicaciones fuera de almacen o basura).")
    
except Exception as e:
    import traceback
    print(f"Error al procesar Excel: {e}")
    traceback.print_exc()
