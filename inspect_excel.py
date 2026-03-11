import pandas as pd
import sys
import json

file_path = "inventario.xls"

try:
    # Need to have xlrd installed for .xls files or openpyxl for .xlsx
    # We will just print the columns first to see the structure
    df = pd.read_excel(file_path, nrows=5)
    print("Columnas:", df.columns.tolist())
    print("Primeras filas:")
    print(df.head().to_json(orient='records', force_ascii=False))
except Exception as e:
    print(f"Error reading file: {e}")
