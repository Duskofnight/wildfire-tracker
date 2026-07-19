'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import MaplibreGraticule from 'maplibre-graticule';
import 'maplibre-gl/dist/maplibre-gl.css';

type Fire = { latitude: string; longitude: string; confidence: string; frp: string; acq_date: string; acq_time: string };

const REFRESH_INTERVAL_SEC = 5 * 60; // 5 minutes

export default function FireMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [fireCount, setFireCount] = useState(0);
  const [displayCount, setDisplayCount] = useState(0);
  const [totalFrp, setTotalFrp] = useState(0);
  const [lastUpdated, setLastUpdated] = useState('');
  const [loading, setLoading] = useState(true);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_SEC);
  const [utcTime, setUtcTime] = useState('');
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);

  const countUpTo = useCallback((target: number) => {
    const duration = 900;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayCount(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  const loadFires = useCallback(async (map: maplibregl.Map, isFirstLoad: boolean) => {
    const res = await fetch('/api/fires');
    const data: Fire[] = await res.json();

    const geojson = {
      type: 'FeatureCollection' as const,
      features: data.map(f => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [parseFloat(f.longitude), parseFloat(f.latitude)] },
        properties: { confidence: f.confidence, frp: f.frp, acq_date: f.acq_date, acq_time: f.acq_time },
      })),
    };

    const source = map.getSource('fires') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson as any);
    } else {
      map.addSource('fires', { type: 'geojson', data: geojson });

      // 'h' = high, 'n' = nominal (VIIRS values)
      const confidenceColor = ['match', ['get', 'confidence'],
        'h', '#ff3b3b',
        'n', '#ffa94d',
        '#ffd166',
      ];

      map.addLayer({
        id: 'fire-glow',
        type: 'circle',
        source: 'fires',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 5, 4, 10, 14],
          'circle-color': confidenceColor as any,
          'circle-opacity': 0.25,
          'circle-blur': 1,
        },
      });

      map.addLayer({
        id: 'fire-core',
        type: 'circle',
        source: 'fires',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 5, 1.6, 10, 5],
          'circle-color': confidenceColor as any,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(255,255,255,0.4)',
        },
      });

      map.on('mouseenter', 'fire-core', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'fire-core', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'fire-core', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        new maplibregl.Popup({ className: 'fire-popup' })
          .setLngLat((f.geometry as any).coordinates)
          .setHTML(`CONFIDENCE: ${p.confidence.toUpperCase()}<br/>FRP: ${p.frp} MW<br/>${p.acq_date} ${p.acq_time} UTC`)
          .addTo(map);
      });

      map.on('mousemove', (e) => {
        setCursorCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    }

    const sumFrp = data.reduce((acc, f) => acc + (parseFloat(f.frp) || 0), 0);

    setFireCount(data.length);
    setTotalFrp(sumFrp);
    setLastUpdated(new Date().toLocaleTimeString());
    setSecondsUntilRefresh(REFRESH_INTERVAL_SEC);

    if (isFirstLoad) setLoading(false);
    countUpTo(data.length);
  }, [countUpTo]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [-114.07, 51.05],
      zoom: 4,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });

      const layers = map.getStyle().layers;
      layers.forEach((layer: any) => {
        if (layer.id.toLowerCase().includes('water')) {
          try {
            if (layer.type === 'fill') {
              map.setPaintProperty(layer.id, 'fill-color', '#02060c');
              map.setPaintProperty(layer.id, 'fill-opacity', 1);
            } else if (layer.type === 'background') {
              map.setPaintProperty(layer.id, 'background-color', '#02060c');
            }
          } catch (e) {}
        }
      });

      try {
  ['boundary_country_z0-4', 'boundary_country_z5-'].forEach((id) => {
    map.setPaintProperty(id, 'line-color', '#ffe14d');
    map.setPaintProperty(id, 'line-width', [
      'interpolate', ['linear'], ['zoom'],
      0, 0.4,
      5, 0.8,
      10, 1.6,
    ]);
    map.setPaintProperty(id, 'line-opacity', 0.9);
  });
} catch (e) {}

      map.addControl(new MaplibreGraticule({
        paint: { 'line-color': 'rgba(79,216,232,0.12)', 'line-width': 0.5 },
      }));
    });

    map.on('load', () => {
      loadFires(map, true);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [loadFires]);

  // Auto-refresh + countdown ticker
  useEffect(() => {
    if (loading) return;

    const tick = setInterval(() => {
      setSecondsUntilRefresh(prev => {
        if (prev <= 1) {
          const map = mapRef.current;
          if (map) loadFires(map, false);
          return REFRESH_INTERVAL_SEC;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [loading, loadFires]);

  // Live UTC clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setUtcTime(`${h}:${m}:${s} UTC`);
    };
    updateClock();
    const clockTick = setInterval(updateClock, 1000);
    return () => clearInterval(clockTick);
  }, []);

  const mm = String(Math.floor(secondsUntilRefresh / 60)).padStart(2, '0');
  const ss = String(secondsUntilRefresh % 60).padStart(2, '0');

  const formatCoord = (val: number, pos: string, neg: string) => {
    const dir = val >= 0 ? pos : neg;
    return `${Math.abs(val).toFixed(3)}°${dir}`;
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}>
      <div className="star-sky" />
      <div ref={mapContainer} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }} />

      <div className="hud-panel hud-header">
        <div className="header-live-dot" />
        <div>
          <div className="header-title">GLOBAL WILDFIRE TRACKER</div>
          <div className="header-subtitle">Real-time active fire detections from NASA satellite data</div>
        </div>
        <div className="header-clock">{utcTime}</div>
      </div>

      {loading && (
        <div className="loading-screen">
          <div className="radar-sweep" />
          <div className="loading-text">ACQUIRING SATELLITE FEED…</div>
          <div className="loading-scan">SCANNING<span className="dots"><span>.</span><span>.</span><span>.</span></span></div>
        </div>
      )}

      {!loading && (
        <>
          <div
            className={`hud-panel hud-stats ${statsExpanded ? 'expanded' : ''}`}
            onClick={() => setStatsExpanded(prev => !prev)}
          >
            <div className="hud-label">SATELLITE FEED · VIIRS NOAA-20</div>
            <div className="hud-count">{displayCount}</div>
            <div className="hud-sub">ACTIVE DETECTIONS</div>

            <div className="hud-frp">{totalFrp.toLocaleString(undefined, { maximumFractionDigits: 0 })} MW</div>
            <div className="hud-sub">TOTAL RADIATIVE POWER</div>

            <div className="hud-divider" />
            <div className="hud-status-row">
              <span className="status-dot" />
              <span>SYSTEM STATUS: ONLINE</span>
            </div>
            <div className="hud-sync">LAST SYNC: {lastUpdated}</div>
            <div className="hud-sync">NEXT SYNC: {mm}:{ss}</div>
          </div>

          <div
            className={`hud-panel hud-legend ${legendExpanded ? 'expanded' : ''}`}
            onClick={() => setLegendExpanded(prev => !prev)}
          >
            <div className="hud-label">LEGEND</div>
            <div className="legend-row"><span className="dot" style={{ background: '#ff3b3b' }} /> High confidence</div>
            <div className="legend-row"><span className="dot" style={{ background: '#ffa94d' }} /> Nominal confidence</div>
            <div className="legend-row">Click a dot for details</div>

            <div className="legend-divider" />
            <div className="hud-label" style={{ marginBottom: 6 }}>FIRE RADIATIVE POWER</div>
            <div className="frp-gradient-bar" />
            <div className="frp-gradient-labels">
              <span>LOW</span><span>HIGH</span>
            </div>
            <div className="legend-row muted">Heat output of the fire, in MW</div>

            <div className="legend-divider" />
            <div className="legend-row muted">Drag to rotate · Scroll to zoom</div>
            <div className="legend-row muted">Zoom in for street-level detail</div>
            <div className="legend-row muted">Source: NASA FIRMS, last 48h</div>
          </div>

          <div className="hud-panel hud-coords">
            {cursorCoords
              ? `${formatCoord(cursorCoords.lat, 'N', 'S')}  ${formatCoord(cursorCoords.lng, 'E', 'W')}`
              : 'MOVE CURSOR OVER GLOBE'}
          </div>
        </>
      )}
    </div>
  );
}