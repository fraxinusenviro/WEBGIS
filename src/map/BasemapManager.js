/**
 * Basemap definitions for MapLibre GL JS
 */
export const BASEMAPS = {
  osm: {
    name: 'OpenStreetMap',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxzoom: 19,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  },

  topo: {
    name: 'OpenTopoMap',
    style: {
      version: 8,
      sources: {
        topo: {
          type: 'raster',
          tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>, <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxzoom: 17,
        },
      },
      layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
    },
  },

  satellite: {
    name: 'ESRI World Imagery',
    style: {
      version: 8,
      sources: {
        esri_sat: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
          maxzoom: 20,
        },
      },
      layers: [{ id: 'esri_sat', type: 'raster', source: 'esri_sat' }],
    },
  },

  'esri-topo': {
    name: 'ESRI World Topo',
    style: {
      version: 8,
      sources: {
        esri_topo: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
          maxzoom: 20,
        },
      },
      layers: [{ id: 'esri_topo', type: 'raster', source: 'esri_topo' }],
    },
  },

  dark: {
    name: 'Dark Matter',
    style: {
      version: 8,
      sources: {
        dark: {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© <a href="https://carto.com">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxzoom: 19,
        },
      },
      layers: [{ id: 'dark', type: 'raster', source: 'dark' }],
    },
  },

  positron: {
    name: 'Positron (Light)',
    style: {
      version: 8,
      sources: {
        positron: {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© <a href="https://carto.com">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxzoom: 19,
        },
      },
      layers: [{ id: 'positron', type: 'raster', source: 'positron' }],
    },
  },

  'nasa-blue': {
    name: 'NASA Blue Marble',
    style: {
      version: 8,
      sources: {
        nasa: {
          type: 'raster',
          tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'],
          tileSize: 256,
          attribution: 'Imagery provided by NASA GIBS',
          maxzoom: 8,
        },
      },
      layers: [{ id: 'nasa', type: 'raster', source: 'nasa' }],
    },
  },

  // ---- Canadian Elevation (NRCan) ----
  'hrdem-dtm-hillshade': {
    name: 'HRDEM DTM Hillshade',
    style: {
      version: 8,
      sources: {
        hrdem_dtm: {
          type: 'raster',
          tiles: ['https://datacube.services.geo.ca/ows/elevation?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=hrdem-dtm%3Ahillshade&CRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'],
          tileSize: 256,
          attribution: '© Natural Resources Canada',
          maxzoom: 17,
        },
      },
      layers: [{ id: 'hrdem_dtm', type: 'raster', source: 'hrdem_dtm' }],
    },
  },

  'hrdem-dsm-hillshade': {
    name: 'HRDEM DSM Hillshade',
    style: {
      version: 8,
      sources: {
        hrdem_dsm: {
          type: 'raster',
          tiles: ['https://datacube.services.geo.ca/ows/elevation?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=hrdem-dsm%3Ahillshade&CRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'],
          tileSize: 256,
          attribution: '© Natural Resources Canada',
          maxzoom: 17,
        },
      },
      layers: [{ id: 'hrdem_dsm', type: 'raster', source: 'hrdem_dsm' }],
    },
  },

  // ---- ESRI ----
  'esri-imagery-hybrid': {
    name: 'ESRI Imagery Hybrid',
    style: {
      version: 8,
      sources: {
        esri_hybrid: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
          maxzoom: 20,
        },
      },
      layers: [{ id: 'esri_hybrid', type: 'raster', source: 'esri_hybrid' }],
    },
  },

  none: {
    name: 'None',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {},
      layers: [],
    },
  },
};

export class BasemapManager {
  constructor(map) {
    this._map = map;
    this._current = null;
  }

  setCurrent(basemapId) {
    if (!BASEMAPS[basemapId]) return;
    this._current = basemapId;
    // Swap entire style but preserve user layers
    // The map style is set once; user layers are added on top
    return basemapId;
  }

  getCurrent() { return this._current; }

  getStyleDef(basemapId) {
    return BASEMAPS[basemapId]?.style || BASEMAPS.osm.style;
  }

  getAll() {
    return Object.entries(BASEMAPS).map(([id, b]) => ({ id, name: b.name }));
  }
}
