import pandas as pd
import json
import re
import math

file_path = "inventario.xls"

try:
    df = pd.read_excel(file_path)
    
    # We want to map: Aisle ID -> items array
    aisles_data = {}
    
    # Get column names (since they might have weird spaces and encoding issues)
    cols = df.columns.tolist()
    col_codigo = cols[0]
    col_desc = cols[1]
    col_ubi = cols[2]
    col_peso = 'Unnamed: 4'
    col_stock = '---Stock ---'
    
    for index, row in df.iterrows():
        ubi_raw = str(row.get(col_ubi, ""))
        if pd.isna(row.get(col_ubi)): 
            continue
            
        ubi_raw = ubi_raw.strip().upper()
        
        # Extract location ID: "C44 lote:1" -> "44"
        # "TALLER" -> "TALLER"
        # "MONGE" -> "MONGE"
        
        aisle_id = None
        if "TALLER" in ubi_raw:
            aisle_id = "TALLER"
        elif "MONGE" in ubi_raw:
            aisle_id = "MONGE"
        elif ubi_raw.startswith("C"):
            # Extract numbers after C
            m = re.search(r'C(\d+)', ubi_raw)
            if m:
                # pad with 0 if needed to match our '01', '02' format, or keep as is?
                # User said C44 is 44. The layout expects '01', '02'... '81'.
                aisle_id = str(m.group(1)).zfill(2)
        
        if not aisle_id:
            # If no clear match, put it in 'SIN_UBICACION'
            aisle_id = "OTROS"
            
        if aisle_id not in aisles_data:
            aisles_data[aisle_id] = {"items": []}
            
        codigo = str(row.get(col_codigo, "")).strip()
        desc = str(row.get(col_desc, "")).strip()
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
            
        # Try to roughly extract gramaje from desc (e.g., "135G", "135 GRS")
        gramaje = "-"
        gm = re.search(r'(\d+)\s*(G|GRS|GR|G/)', desc.upper())
        if gm:
            gramaje = f"{gm.group(1)}g"
            
        # Try to roughly extract type/brand based on first words
        words = desc.split()
        marca = words[0] if len(words) > 0 else "-"
        
        item_obj = {
            "id": codigo,
            "tipo": desc,
            "gramaje": gramaje,
            "proveedor": marca,
            "kilos": peso,
            "hojas": hojas,
            "fecha_entrada": "Sincronizado Excel"
        }
        
        aisles_data[aisle_id]["items"].append(item_obj)
        
    with open("seed.json", "w", encoding='utf-8') as f:
        json.dump(aisles_data, f, ensure_ascii=False, indent=2)
        
    print(f"Generado seed.json con {len(aisles_data.keys())} pasillos encontrados.")
    
except Exception as e:
    print(f"Error: {e}")
