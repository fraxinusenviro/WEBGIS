/**
 * Basemap definitions for MapLibre GL JS
 *
 * HRDEM services are provided by Natural Resources Canada (NRCan).
 * WMS endpoint: https://datacube.services.geo.ca/ows/elevation
 * If layer names change, update the LAYERS= parameter in the tile URLs below.
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

  // ESRI Imagery Hybrid: satellite imagery with street/boundary labels overlay
  // Uses two tile layers: imagery base + reference labels overlay
  'esri-imagery-hybrid': {
    name: 'ESRI Imagery Hybrid',
    hybrid: true,         // flag for BasemapLayerManager to render two layers
    style: {
      version: 8,
      sources: {
        esri_sat_hybrid: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
          maxzoom: 20,
        },
        esri_hybrid_labels: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
          maxzoom: 20,
        },
      },
      layers: [
        { id: 'esri_sat_hybrid', type: 'raster', source: 'esri_sat_hybrid' },
        { id: 'esri_hybrid_labels', type: 'raster', source: 'esri_hybrid_labels' },
      ],
    },
    // Extra overlay tiles rendered on top of the base imagery
    overlayTiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
    overlayMaxzoom: 20,
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

  // HRDEM DTM Hillshade — Natural Resources Canada
  // Source: https://datacube.services.geo.ca/ows/elevation (WMS)
  // Layer: dtm-hillshade (verify layer name at service endpoint)
  'hrdem-dtm-hillshade': {
    name: 'HRDEM DTM Hillshade',
    style: {
      version: 8,
      sources: {
        hrdem_dtm_hs: {
          type: 'raster',
          tiles: [
            'https://datacube.services.geo.ca/ows/elevation?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
            '&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256' +
            '&LAYERS=dtm-hillshade&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857',
          ],
          tileSize: 256,
          attribution: '© Natural Resources Canada (NRCan) — HRDEM',
          maxzoom: 16,
        },
      },
      layers: [{ id: 'hrdem_dtm_hs', type: 'raster', source: 'hrdem_dtm_hs' }],
    },
  },

  // HRDEM DSM Hillshade — Natural Resources Canada
  // Source: https://datacube.services.geo.ca/ows/elevation (WMS)
  // Layer: dsm-hillshade (verify layer name at service endpoint)
  'hrdem-dsm-hillshade': {
    name: 'HRDEM DSM Hillshade',
    style: {
      version: 8,
      sources: {
        hrdem_dsm_hs: {
          type: 'raster',
          tiles: [
            'https://datacube.services.geo.ca/ows/elevation?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
            '&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256' +
            '&LAYERS=dsm-hillshade&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857',
          ],
          tileSize: 256,
          attribution: '© Natural Resources Canada (NRCan) — HRDEM',
          maxzoom: 16,
        },
      },
      layers: [{ id: 'hrdem_dsm_hs', type: 'raster', source: 'hrdem_dsm_hs' }],
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
