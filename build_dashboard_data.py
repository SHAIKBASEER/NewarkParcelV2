import json
import math
import sqlite3
import struct
from pathlib import Path

GPKG = Path(r"C:\Users\Lucifer\Desktop\Newark_Essex_Regrid_Final.gpkg")
OUT = Path("data.js")
OUT_ATTR = Path("data_attrs.js")
OUT_GEOM = Path("data_geom.js")
OUT_COMPACT = Path("data_compact.js")
COMPACT_SHARD_PREFIX = "data_compact_"
COMPACT_SHARD_TARGET_BYTES = 20 * 1024 * 1024

US_FOOT = 0.304800609601219
A = 6378137.0
INV_F = 298.257222101
F = 1 / INV_F
E2 = F * (2 - F)
EP2 = E2 / (1 - E2)
LAT0 = math.radians(38.8333333333333)
LON0 = math.radians(-74.5)
K0 = 0.9999
FE = 492125.0 * US_FOOT
FN = 0.0

PUBLIC_TERMS = (
    "CITY OF NEWARK",
    "NEWARK CITY",
    "NEWARK HOUSING",
    "HOUSING AUTHORITY",
    "BOARD OF EDUCATION",
    "COUNTY OF ESSEX",
    "ESSEX COUNTY",
    "STATE OF NEW JERSEY",
    "NEW JERSEY",
    "NJ TRANSIT",
    "PORT AUTHORITY",
    "UNITED STATES",
    "U S ",
    "US POSTAL",
    "NEWARK PUBLIC",
    "REDEVELOPMENT AGENCY",
    "PUBLIC SCHOOLS",
    "MUNICIPAL",
    "TOWNSHIP",
    "AUTHORITY",
)

NONPROFIT_TERMS = (
    "CHURCH",
    "TEMPLE",
    "MOSQUE",
    "SYNAGOGUE",
    "TRUSTEES",
    "FOUNDATION",
    "COMMUNITY",
    "NONPROFIT",
    "NON-PROFIT",
    "HOSPITAL",
    "UNIVERSITY",
    "COLLEGE",
    "SCHOOL",
    "DIOCESE",
    "MISSION",
    "YMCA",
    "Y W C A",
    "YWCA",
    "INC NON PROFIT",
    "CHARITABLE",
    "MINISTRY",
    "BAPTIST",
    "METHODIST",
    "PRESBYTERIAN",
    "CATHOLIC",
    "EPISCOPAL",
    "LUTHERAN",
    "CONGREGATION",
)

CORPORATE_TERMS = (
    " LLC",
    " L.L.C",
    " INC",
    " CORP",
    " COMPANY",
    " CO ",
    " LP",
    " L P",
    " LTD",
    " ASSOCIATES",
    " PARTNERS",
    " HOLDINGS",
    " PROPERTIES",
    " REALTY",
    " DEVELOPMENT",
    " INVESTMENTS",
    " URBAN RENEWAL",
)

LAND_USE_BY_CLASS = {
    "1": "Vacant land",
    "2": "Residential",
    "3A": "Farm residential",
    "3B": "Farm qualified",
    "4A": "Commercial",
    "4B": "Industrial",
    "4C": "Apartment",
    "5A": "Railroad class I",
    "5B": "Railroad class II",
    "15A": "Public school",
    "15B": "Public property",
    "15C": "Public property",
    "15D": "Church / charitable",
    "15E": "Cemetery",
    "15F": "Other exempt",
}


def meridional_arc(phi):
    e4 = E2 * E2
    e6 = e4 * E2
    return A * (
        (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
        - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
        + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
        - (35 * e6 / 3072) * math.sin(6 * phi)
    )


M0 = meridional_arc(LAT0)


def inverse_nj_ft(x_ft, y_ft):
    x = x_ft * US_FOOT
    y = y_ft * US_FOOT
    m = M0 + (y - FN) / K0
    mu = m / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2**3 / 256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    j1 = 3 * e1 / 2 - 27 * e1**3 / 32
    j2 = 21 * e1 * e1 / 16 - 55 * e1**4 / 32
    j3 = 151 * e1**3 / 96
    j4 = 1097 * e1**4 / 512
    fp = mu + j1 * math.sin(2 * mu) + j2 * math.sin(4 * mu) + j3 * math.sin(6 * mu) + j4 * math.sin(8 * mu)
    sinfp = math.sin(fp)
    cosfp = math.cos(fp)
    tanfp = math.tan(fp)
    c1 = EP2 * cosfp * cosfp
    t1 = tanfp * tanfp
    n1 = A / math.sqrt(1 - E2 * sinfp * sinfp)
    r1 = A * (1 - E2) / ((1 - E2 * sinfp * sinfp) ** 1.5)
    d = (x - FE) / (n1 * K0)
    lat = fp - (n1 * tanfp / r1) * (
        d * d / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d**6 / 720
    )
    lon = LON0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d**5 / 120
    ) / cosfp
    return [round(math.degrees(lon), 5), round(math.degrees(lat), 5)]


def read_wkb_geometry(blob):
    flags = blob[3]
    envelope_code = (flags >> 1) & 7
    offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(envelope_code, 0)
    endian = "<" if blob[offset] == 1 else ">"

    def uint(pos):
        return struct.unpack(endian + "I", blob[pos : pos + 4])[0]

    def dbl(pos):
        return struct.unpack(endian + "d", blob[pos : pos + 8])[0]

    pos = offset + 1
    geom_type = uint(pos)
    pos += 4
    polygons = []
    if geom_type == 6:
        poly_count = uint(pos)
        pos += 4
        for _ in range(poly_count):
            pos += 1
            poly_type = uint(pos)
            pos += 4
            if poly_type != 3:
                raise ValueError(f"Unsupported WKB polygon type {poly_type}")
            ring_count = uint(pos)
            pos += 4
            rings = []
            for _ in range(ring_count):
                point_count = uint(pos)
                pos += 4
                ring = []
                for _ in range(point_count):
                    x = dbl(pos)
                    y = dbl(pos + 8)
                    pos += 16
                    ring.append(inverse_nj_ft(x, y))
                rings.append(ring)
            polygons.append(rings)
    elif geom_type == 3:
        ring_count = uint(pos)
        pos += 4
        rings = []
        for _ in range(ring_count):
            point_count = uint(pos)
            pos += 4
            ring = []
            for _ in range(point_count):
                x = dbl(pos)
                y = dbl(pos + 8)
                pos += 16
                ring.append(inverse_nj_ft(x, y))
            rings.append(ring)
        polygons.append(rings)
    else:
        raise ValueError(f"Unsupported WKB geometry type {geom_type}")
    return polygons


def point_line_distance(pt, start, end):
    x, y = pt
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify_ring(points, tolerance=0.000055):
    if len(points) <= 5:
        return points
    closed = points[0] == points[-1]
    work = points[:-1] if closed else points

    def rdp(seq):
        if len(seq) <= 2:
            return seq
        start = seq[0]
        end = seq[-1]
        max_dist = -1
        max_idx = 0
        for idx in range(1, len(seq) - 1):
            dist = point_line_distance(seq[idx], start, end)
            if dist > max_dist:
                max_dist = dist
                max_idx = idx
        if max_dist > tolerance:
            return rdp(seq[: max_idx + 1])[:-1] + rdp(seq[max_idx:])
        return [start, end]

    reduced = rdp(work)
    if closed and reduced[0] != reduced[-1]:
        reduced.append(reduced[0])
    return reduced if len(reduced) >= 4 else points


def simplify_multipolygon(polygons):
    return [[simplify_ring(ring) for ring in poly] for poly in polygons]


def ownership_details(owner, prop_class, lbcs_owner):
    text = f"{owner or ''} {lbcs_owner or ''}".upper()
    if any(term in text for term in PUBLIC_TERMS) or str(prop_class or "").startswith("15B"):
        subtype = "Public agency"
        if "HOUSING" in text:
            subtype = "Housing authority"
        elif "BOARD OF EDUCATION" in text or "SCHOOL" in text:
            subtype = "Education agency"
        return "Public", subtype, "High"
    if any(term in text for term in NONPROFIT_TERMS) or str(prop_class or "").startswith(("15D", "15A")):
        subtype = "Religious / charitable"
        if "UNIVERSITY" in text or "COLLEGE" in text:
            subtype = "Education nonprofit"
        elif "HOSPITAL" in text:
            subtype = "Healthcare nonprofit"
        return "Nonprofit", subtype, "Medium"
    if any(term in text for term in CORPORATE_TERMS):
        return "Private", "Corporate / LLC", "Medium"
    if text.strip():
        return "Private", "Individual / trust", "Low"
    return "Private", "Unknown private", "Low"


def land_use(prop_class, prop_use, lbcs_desc):
    code = str(prop_class or "").strip().upper()
    if code in LAND_USE_BY_CLASS:
        return LAND_USE_BY_CLASS[code]
    if code[:2] in LAND_USE_BY_CLASS:
        return LAND_USE_BY_CLASS[code[:2]]
    if lbcs_desc:
        return str(lbcs_desc).title()
    if prop_use:
        return str(prop_use).title()
    return "Unclassified"


def vacancy_details(land_val, imprvt_val, net_value):
    land = float(land_val or 0)
    improvement = float(imprvt_val or 0)
    net = float(net_value or 0)
    if improvement <= 0:
        return "Vacant", "County IMPRVT_VAL is 0 or missing"
    if land > 0 and improvement / land <= 0.20:
        return "Likely underutilized", "County IMPRVT_VAL is <= 20% of LAND_VAL"
    return "Occupied / active", "County IMPRVT_VAL is > 20% of LAND_VAL"


def best_value(row, primary, fallback, default=0):
    value = row[primary]
    if value not in (None, ""):
        return value, primary
    value = row[fallback]
    if value not in (None, ""):
        return value, fallback
    return default, "Missing filled as 0"


def best_text(row, primary, fallback, default="Unknown"):
    value = row[primary]
    if value not in (None, ""):
        return value, primary
    value = row[fallback]
    if value not in (None, ""):
        return value, fallback
    return default, "Missing filled as Unknown"


def inferred_geography(lat, lon):
    if lat is None or lon is None:
        return "Unknown", "Unknown"
    ward = "North Ward" if lat >= 40.765 else "South Ward"
    if lon < -74.205:
        ward = "West Ward"
    elif lon > -74.165 and lat < 40.755:
        ward = "East Ward"
    elif -74.205 <= lon <= -74.165 and 40.725 <= lat <= 40.765:
        ward = "Central Ward"
    if lat >= 40.78:
        hood = "North Newark"
    elif lon < -74.215:
        hood = "Upper West Side"
    elif lon < -74.195:
        hood = "West Side / Vailsburg"
    elif lon > -74.15 and lat < 40.735:
        hood = "Port / Industrial East"
    elif 40.73 <= lat <= 40.75 and -74.19 <= lon <= -74.16:
        hood = "Downtown / Ironbound Edge"
    elif lat < 40.72:
        hood = "South Newark"
    else:
        hood = "Central Newark"
    return ward, hood


def opportunity_score(row, status, own_type):
    value = float(row["REGRID_parval"] or row["NET_VALUE"] or 0)
    acres = float(row["REGRID_gisacre"] or row["CALC_ACRE"] or 0)
    impr = float(row["REGRID_improvval"] or row["IMPRVT_VAL"] or 0)
    land = float(row["REGRID_landval"] or row["LAND_VAL"] or 0)
    score = 0
    if status in {"Vacant", "Vacant land", "Likely underutilized"}:
        score += 42
    if acres >= 0.25:
        score += 18
    elif acres >= 0.1:
        score += 10
    if impr <= 0 or (land and impr / land < 0.25):
        score += 15
    if value and value < 250000:
        score += 8
    if own_type in {"Public", "Nonprofit"}:
        score += 12
    if row["REGRID_qoz"] and str(row["REGRID_qoz"]).upper().startswith("Y"):
        score += 5
    return min(100, score)


def cluster_key(lat, lon, step=0.006):
    if lat is None or lon is None:
        return "unknown"
    return f"{round(lat / step) * step:.3f},{round(lon / step) * step:.3f}"


def compact_shard_text(metadata, schema, rows):
    payload = {"metadata": metadata, "schema": schema, "rows": rows}
    return (
        "window.NEWARK_COMPACT_SHARDS=window.NEWARK_COMPACT_SHARDS||[];"
        "window.NEWARK_COMPACT_SHARDS.push("
        + json.dumps(payload, separators=(",", ":"))
        + ");\n"
    )


def write_compact_shards(metadata, schema, rows):
    for old_shard in Path(".").glob(f"{COMPACT_SHARD_PREFIX}*.js"):
        old_shard.unlink()
    if OUT_COMPACT.exists():
        OUT_COMPACT.unlink()

    full_size = len(compact_shard_text(metadata, schema, rows).encode("utf-8"))
    shard_count = max(1, math.ceil(full_size / COMPACT_SHARD_TARGET_BYTES))
    while True:
        chunk_size = math.ceil(len(rows) / shard_count)
        shard_texts = []
        too_large = False
        for index in range(shard_count):
            start = index * chunk_size
            stop = min(start + chunk_size, len(rows))
            text = compact_shard_text(metadata, schema, rows[start:stop])
            if len(text.encode("utf-8")) > COMPACT_SHARD_TARGET_BYTES:
                too_large = True
                break
            shard_texts.append(text)
        if not too_large:
            break
        shard_count += 1

    for index, text in enumerate(shard_texts, start=1):
        Path(f"{COMPACT_SHARD_PREFIX}{index:02d}.js").write_text(text, encoding="utf-8")
    return shard_count


FIELDS = [
    "fid",
    "geom",
    "PAMS_PIN",
    "PCLBLOCK",
    "PCLLOT",
    "PROP_CLASS",
    "PROP_LOC",
    "OWNER_NAME",
    "LAND_VAL",
    "IMPRVT_VAL",
    "NET_VALUE",
    "CALC_ACRE",
    "PROP_USE",
    "REGRID_zoning",
    "REGRID_zoning_type",
    "REGRID_zoning_description",
    "REGRID_usps_vacancy",
    "REGRID_lat",
    "REGRID_lon",
    "REGRID_owner",
    "REGRID_address",
    "REGRID_parcelnumb",
    "REGRID_path",
    "REGRID_ll_bldg_footprint_sqft",
    "REGRID_ll_bldg_count",
    "REGRID_lbcs_function_desc",
    "REGRID_lbcs_ownership_desc",
    "REGRID_qoz",
    "REGRID_redev_2023",
    "REGRID_parval",
    "REGRID_improvval",
    "REGRID_landval",
    "REGRID_gisacre",
    "REGRID_census_tract",
    "REGRID_census_block",
    "REGRID_census_blockgroup",
    "REGRID_census_zcta",
    "REGRID_median_household_income",
    "REGRID_population_density",
    "REGRID_population_growth_past_5_years",
    "REGRID_population_growth_next_5_years",
    "REGRID_housing_affordability_index",
]


def main():
    con = sqlite3.connect(GPKG)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        f"""
        select {', '.join(FIELDS)}
        from newark_essex_regrid
        where geom is not null
          and REGRID_parcelnumb is not null
          and trim(REGRID_parcelnumb) <> ''
          and REGRID_path is not null
          and trim(REGRID_path) <> ''
          and REGRID_owner is not null
          and trim(REGRID_owner) <> ''
        """
    ).fetchall()
    features = []
    cluster_counts = {}
    for row in rows:
        lat = row["REGRID_lat"]
        lon = row["REGRID_lon"]
        own, owner_subtype, owner_confidence = ownership_details(row["REGRID_owner"], row["PROP_CLASS"], row["REGRID_lbcs_ownership_desc"])
        use = land_use(row["PROP_CLASS"], row["PROP_USE"], row["REGRID_lbcs_function_desc"])
        status, vacancy_method = vacancy_details(row["LAND_VAL"], row["IMPRVT_VAL"], row["NET_VALUE"])
        assessed, assessed_source = best_value(row, "REGRID_parval", "NET_VALUE")
        land_value, land_source = best_value(row, "REGRID_landval", "LAND_VAL")
        improvement_value, improvement_source = best_value(row, "REGRID_improvval", "IMPRVT_VAL")
        lot_acres, lot_source = best_value(row, "REGRID_gisacre", "CALC_ACRE")
        zoning, zoning_source = best_text(row, "REGRID_zoning", "REGRID_zoning_type")
        ward, neighborhood = inferred_geography(lat, lon)
        score = opportunity_score(row, status, own)
        ckey = cluster_key(lat, lon)
        if score >= 45:
            cluster_counts[ckey] = cluster_counts.get(ckey, 0) + 1
        try:
            polygons = simplify_multipolygon(read_wkb_geometry(row["geom"]))
        except Exception:
            continue
        geometry = {
            "type": "MultiPolygon",
            "coordinates": polygons,
        }
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "id": row["REGRID_parcelnumb"] or row["REGRID_path"],
                    "regridPath": row["REGRID_path"] or "",
                    "regridParcel": row["REGRID_parcelnumb"] or "",
                    "pamsPin": row["PAMS_PIN"] or "",
                    "block": str(row["PCLBLOCK"] or ""),
                    "lot": str(row["PCLLOT"] or ""),
                    "address": row["REGRID_address"] or row["PROP_LOC"] or "",
                    "owner": row["REGRID_owner"] or "Unknown",
                    "modOwner": row["OWNER_NAME"] or "",
                    "ownership": own,
                    "ownerSubtype": owner_subtype,
                    "ownerConfidence": owner_confidence,
                    "lbcsFunction": row["REGRID_lbcs_function_desc"] or "Unknown",
                    "lbcsOwnership": row["REGRID_lbcs_ownership_desc"] or "Unknown",
                    "landUse": use,
                    "propClass": row["PROP_CLASS"] or "",
                    "vacancy": status,
                    "vacancyMethod": vacancy_method,
                    "assessed": round(float(assessed or 0), 2),
                    "assessedSource": assessed_source,
                    "landValue": round(float(land_value or 0), 2),
                    "landValueSource": land_source,
                    "improvementValue": round(float(improvement_value or 0), 2),
                    "improvementValueSource": improvement_source,
                    "lotAcres": round(float(lot_acres or 0), 4),
                    "lotSizeSource": lot_source,
                    "zoning": zoning,
                    "zoningSource": zoning_source,
                    "ward": ward,
                    "neighborhood": neighborhood,
                    "lat": round(float(lat or 0), 6),
                    "lon": round(float(lon or 0), 6),
                    "latitude": round(float(lat or 0), 6),
                    "longitude": round(float(lon or 0), 6),
                    "censusTract": str(row["REGRID_census_tract"] or ""),
                    "censusBlock": str(row["REGRID_census_block"] or ""),
                    "censusBlockGroup": str(row["REGRID_census_blockgroup"] or ""),
                    "censusZcta": str(row["REGRID_census_zcta"] or ""),
                    "medianHouseholdIncome": round(float(row["REGRID_median_household_income"] or 0), 2),
                    "populationDensity": round(float(row["REGRID_population_density"] or 0), 2),
                    "populationGrowthPast5": round(float(row["REGRID_population_growth_past_5_years"] or 0), 4),
                    "populationGrowthNext5": round(float(row["REGRID_population_growth_next_5_years"] or 0), 4),
                    "housingAffordabilityIndex": round(float(row["REGRID_housing_affordability_index"] or 0), 2),
                    "qoz": row["REGRID_qoz"] or "",
                    "redevelopment": row["REGRID_redev_2023"] or "",
                    "opportunity": score,
                    "clusterKey": ckey,
                },
            }
        )
    for feature in features:
        feature["properties"]["clusterSize"] = cluster_counts.get(feature["properties"]["clusterKey"], 0)
    attr_features = []
    geom_features = []
    schema = [
        "id", "regridPath", "regridParcel", "pamsPin", "block", "lot", "address", "owner", "modOwner",
        "ownership", "ownerSubtype", "ownerConfidence", "lbcsFunction", "lbcsOwnership", "landUse",
        "propClass", "vacancy", "vacancyMethod", "assessed", "assessedSource", "landValue",
        "landValueSource", "improvementValue", "improvementValueSource", "lotAcres", "lotSizeSource",
        "zoning", "zoningSource", "ward", "neighborhood", "lat", "lon", "latitude", "longitude",
        "censusTract", "censusBlock", "censusBlockGroup", "censusZcta", "medianHouseholdIncome",
        "populationDensity", "populationGrowthPast5", "populationGrowthNext5", "housingAffordabilityIndex",
        "qoz", "redevelopment", "opportunity", "clusterKey", "clusterSize",
    ]
    compact_rows = []
    for feature in features:
        fid = feature["properties"]["id"]
        props = feature["properties"]
        attr_features.append({"id": fid, **props})
        compact_rows.append([props.get(key, "") for key in schema])
        geom_features.append({
            "type": "Feature",
            "geometry": feature["geometry"],
            "properties": {
                "id": fid,
                "vacancy": props["vacancy"],
                "ownership": props["ownership"],
                "opportunity": props["opportunity"],
                "lat": props["lat"],
                "lon": props["lon"],
                "clusterKey": props["clusterKey"],
                "clusterSize": props["clusterSize"],
            },
        })
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "source": str(GPKG),
            "generatedFeatureCount": len(features),
            "notes": [
                "Ward and neighborhood filters are inferred from parcel centroid location because no official ward/neighborhood field was present in the source layer.",
                "Vacancy uses USPS vacancy when present and marks class 1 or no-improvement parcels as inferred opportunity candidates.",
                "Ownership type is inferred from owner name, exempt property class, and LBCS ownership descriptions.",
            ],
        },
        "features": features,
    }
    geom_payload = {
        "type": "FeatureCollection",
        "features": geom_features,
    }
    for legacy_out in (OUT, OUT_ATTR):
        if legacy_out.exists():
            legacy_out.unlink()
    OUT_GEOM.write_text("window.NEWARK_GEOM = " + json.dumps(geom_payload, separators=(",", ":")) + ";\n", encoding="utf-8")
    shard_count = write_compact_shards(payload["metadata"], schema, compact_rows)
    con.close()
    print(f"Wrote dashboard data bundles with {len(features):,} parcels across {shard_count} compact shard(s)")


if __name__ == "__main__":
    main()
