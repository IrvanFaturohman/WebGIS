"""
Script untuk mengekstrak subset data dari dubai_lagi.geojson 
menjadi file-file GeoJSON yang lebih kecil untuk Web GIS.
"""
import json
import os

print("Memuat data GeoJSON utama...")
with open('dubai_lagi.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

features = data['features']
print(f"Total fitur: {len(features)}")

# === 1. POI (Point of Interest) - Titik lokasi fasilitas umum ===
# Ambil semua Point yang punya nama dan kategori (amenity/shop/leisure)
poi_features = []
for f in features:
    geom = f.get('geometry', {})
    props = f.get('properties', {})
    if geom.get('type') == 'Point' and props.get('name'):
        # Tentukan kategori
        kategori = None
        if props.get('amenity'):
            kategori = props['amenity']
        elif props.get('shop'):
            kategori = 'shop_' + props['shop']
        elif props.get('leisure'):
            kategori = 'leisure_' + props['leisure']
        elif props.get('aeroway'):
            kategori = 'aeroway_' + props['aeroway']
        elif props.get('office'):
            kategori = 'office_' + props['office']
        elif props.get('historic'):
            kategori = 'historic_' + props['historic']
        
        if kategori:
            new_props = {
                'nama': props.get('name', 'Tanpa Nama'),
                'kategori': kategori,
                'alamat': props.get('addr_street', '-'),
                'nomor': props.get('addr_housenumber', '-'),
                'operator': props.get('operator', '-'),
                'jam_buka': props.get('opening_hours', '-'),
                'osm_id': props.get('osm_id'),
                'tipe_osm': props.get('osm_type', '-'),
            }
            poi_features.append({
                'type': 'Feature',
                'geometry': geom,
                'properties': new_props
            })

print(f"POI dengan nama & kategori: {len(poi_features)}")

# Batasi sampai 500 POI agar ringan, pilih yang beragam
from collections import defaultdict
poi_by_cat = defaultdict(list)
for f in poi_features:
    poi_by_cat[f['properties']['kategori']].append(f)

selected_poi = []
# Ambil max 30 per kategori, prioritas amenity
for cat in sorted(poi_by_cat.keys()):
    items = poi_by_cat[cat][:30]
    selected_poi.extend(items)
    if len(selected_poi) >= 500:
        break

# Jika kurang dari 500, lanjut ambil sisanya
if len(selected_poi) < 500:
    for cat in sorted(poi_by_cat.keys()):
        remaining = [f for f in poi_by_cat[cat] if f not in selected_poi]
        selected_poi.extend(remaining[:10])
        if len(selected_poi) >= 500:
            break

selected_poi = selected_poi[:500]
print(f"POI yang dipilih: {len(selected_poi)}")

poi_geojson = {
    'type': 'FeatureCollection',
    'features': selected_poi
}

with open('data/poi_dubai.geojson', 'w', encoding='utf-8') as f:
    json.dump(poi_geojson, f, ensure_ascii=False)
print("Saved: data/poi_dubai.geojson")

# === 2. Bangunan penting (Polygon) yang punya nama ===
building_features = []
for f in features:
    geom = f.get('geometry', {})
    props = f.get('properties', {})
    if geom.get('type') in ('Polygon', 'MultiPolygon') and props.get('name'):
        kategori = None
        if props.get('amenity'):
            kategori = props['amenity']
        elif props.get('shop'):
            kategori = 'shop'
        elif props.get('leisure'):
            kategori = props['leisure']
        elif props.get('aeroway'):
            kategori = props['aeroway']
        elif props.get('building') and props['building'] != 'yes':
            kategori = props['building']
        else:
            kategori = 'building'
        
        new_props = {
            'nama': props.get('name', 'Tanpa Nama'),
            'kategori': kategori,
            'alamat': props.get('addr_street', '-'),
            'nomor': props.get('addr_housenumber', '-'),
            'operator': props.get('operator', '-'),
            'osm_id': props.get('osm_id'),
            'tipe_osm': props.get('osm_type', '-'),
        }
        building_features.append({
            'type': 'Feature',
            'geometry': geom,
            'properties': new_props
        })

print(f"Bangunan bernama: {len(building_features)}")

# Batasi 300 bangunan
building_by_cat = defaultdict(list)
for f in building_features:
    building_by_cat[f['properties']['kategori']].append(f)

selected_buildings = []
for cat in sorted(building_by_cat.keys()):
    items = building_by_cat[cat][:25]
    selected_buildings.extend(items)
    if len(selected_buildings) >= 300:
        break

if len(selected_buildings) < 300:
    for cat in sorted(building_by_cat.keys()):
        remaining = [f for f in building_by_cat[cat] if f not in selected_buildings]
        selected_buildings.extend(remaining[:10])
        if len(selected_buildings) >= 300:
            break

selected_buildings = selected_buildings[:300]
print(f"Bangunan yang dipilih: {len(selected_buildings)}")

buildings_geojson = {
    'type': 'FeatureCollection',
    'features': selected_buildings
}

with open('data/bangunan_dubai.geojson', 'w', encoding='utf-8') as f:
    json.dump(buildings_geojson, f, ensure_ascii=False)
print("Saved: data/bangunan_dubai.geojson")

# === 3. Boundary (batas wilayah) ===
with open('clipping_boundary.geojson', 'r', encoding='utf-8') as f:
    boundary = json.load(f)

# Wrap jadi FeatureCollection jika belum
if boundary.get('type') != 'FeatureCollection':
    if boundary.get('type') == 'Feature':
        boundary_fc = {'type': 'FeatureCollection', 'features': [boundary]}
    else:
        boundary_fc = {
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'geometry': boundary,
                'properties': {
                    'nama': 'Batas Wilayah Dubai',
                    'kategori': 'boundary',
                    'deskripsi': 'Area clipping boundary untuk data Dubai OSM'
                }
            }]
        }
else:
    boundary_fc = boundary

with open('data/batas_wilayah.geojson', 'w', encoding='utf-8') as f:
    json.dump(boundary_fc, f, ensure_ascii=False)
print("Saved: data/batas_wilayah.geojson")

# Print statistik kategori
print("\n=== STATISTIK POI ===")
from collections import Counter
poi_cats = Counter(f['properties']['kategori'] for f in selected_poi)
for cat, count in poi_cats.most_common(20):
    print(f"  {cat}: {count}")

print("\n=== STATISTIK BANGUNAN ===")
bldg_cats = Counter(f['properties']['kategori'] for f in selected_buildings)
for cat, count in bldg_cats.most_common(20):
    print(f"  {cat}: {count}")

print("\nSelesai!")
