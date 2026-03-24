import proj4 from 'proj4';

// Common CRS definitions
const CRS_DEFS = {
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
  'EPSG:3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  'EPSG:32614': '+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs',
  'EPSG:32615': '+proj=utm +zone=15 +datum=WGS84 +units=m +no_defs',
  'EPSG:32616': '+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs',
  'EPSG:32617': '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs',
  'EPSG:32618': '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs',
  'EPSG:32619': '+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs',
  'EPSG:26914': '+proj=utm +zone=14 +datum=NAD83 +units=m +no_defs',
  'EPSG:26917': '+proj=utm +zone=17 +datum=NAD83 +units=m +no_defs',
  'EPSG:27700': '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs',
};

// Register all known CRS
Object.entries(CRS_DEFS).forEach(([name, def]) => proj4.defs(name, def));

export function registerCRS(epsgCode, projDef) {
  proj4.defs(epsgCode, projDef);
}

/**
 * Transform coordinates from one CRS to another
 * @param {[number, number]} coord - [x, y]
 * @param {string} fromCRS - e.g. 'EPSG:4326'
 * @param {string} toCRS - e.g. 'EPSG:3857'
 */
export function transformCoord(coord, fromCRS, toCRS) {
  try {
    return proj4(fromCRS, toCRS, coord);
  } catch(e) {
    console.warn('Coord transform failed:', e);
    return coord;
  }
}

/**
 * Transform a GeoJSON FeatureCollection from one CRS to WGS84
 */
export function reprojectGeoJSON(geojson, fromCRS) {
  if (!fromCRS || fromCRS === 'EPSG:4326') return geojson;
  return {
    ...geojson,
    features: geojson.features.map(f => reprojectFeature(f, fromCRS)),
  };
}

export function reprojectFeature(feature, fromCRS) {
  return {
    ...feature,
    geometry: reprojectGeometry(feature.geometry, fromCRS),
  };
}

export function reprojectGeometry(geom, fromCRS) {
  if (!geom) return geom;
  const transform = (coord) => transformCoord(coord, fromCRS, 'EPSG:4326');

  switch(geom.type) {
    case 'Point':
      return { ...geom, coordinates: transform(geom.coordinates) };
    case 'LineString':
    case 'MultiPoint':
      return { ...geom, coordinates: geom.coordinates.map(transform) };
    case 'Polygon':
    case 'MultiLineString':
      return { ...geom, coordinates: geom.coordinates.map(ring => ring.map(transform)) };
    case 'MultiPolygon':
      return { ...geom, coordinates: geom.coordinates.map(poly => poly.map(ring => ring.map(transform))) };
    case 'GeometryCollection':
      return { ...geom, geometries: geom.geometries.map(g => reprojectGeometry(g, fromCRS)) };
    default:
      return geom;
  }
}

/**
 * Detect CRS from GeoJSON CRS member or shapefile projection
 */
export function detectCRS(geojson) {
  if (geojson?.crs?.properties?.name) {
    const name = geojson.crs.properties.name;
    // Normalize URN/OGC formats
    const match = name.match(/EPSG[::]+(\d+)/i);
    if (match) return `EPSG:${match[1]}`;
    return name;
  }
  return 'EPSG:4326';
}

/**
 * Format coordinates for display
 */
export function formatDD(lng, lat) {
  return `Lng: ${lng.toFixed(6)}° &nbsp; Lat: ${lat.toFixed(6)}°`;
}

export function formatDMS(lng, lat) {
  return `${ddToDMS(lat, 'lat')} ${ddToDMS(lng, 'lng')}`;
}

function ddToDMS(decimal, axis) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  const sec = ((abs - deg - min / 60) * 3600).toFixed(1);
  const dir = axis === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  return `${deg}°${min}'${sec}"${dir}`;
}

export function lngLatToMercator(lng, lat) {
  const x = lng * 20037508.34 / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  return [x, y * 20037508.34 / 180];
}

/**
 * Calculate approximate map scale denominator from zoom
 */
export function zoomToScale(zoom, lat = 0) {
  const tileSize = 256;
  const earthCircumference = 2 * Math.PI * 6378137;
  const metersPerPixel = (earthCircumference * Math.cos(lat * Math.PI / 180)) / (tileSize * Math.pow(2, zoom));
  const dpi = 96;
  const inchesPerMeter = 39.3701;
  return Math.round(metersPerPixel * dpi * inchesPerMeter);
}

/**
 * Get bounding box of GeoJSON FeatureCollection
 */
export function getBounds(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const processCoord = ([x, y]) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  const processGeom = (geom) => {
    if (!geom) return;
    switch(geom.type) {
      case 'Point': processCoord(geom.coordinates); break;
      case 'LineString': case 'MultiPoint': geom.coordinates.forEach(processCoord); break;
      case 'Polygon': case 'MultiLineString': geom.coordinates.forEach(r => r.forEach(processCoord)); break;
      case 'MultiPolygon': geom.coordinates.forEach(p => p.forEach(r => r.forEach(processCoord))); break;
      case 'GeometryCollection': geom.geometries.forEach(processGeom); break;
    }
  };
  (geojson.features || []).forEach(f => processGeom(f.geometry));
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

export { proj4 };
