import React, { useState, useLayoutEffect, useRef, useMemo, useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Map } from 'pigeon-maps';
import { clusterGroups } from './marker-clusters.mjs';
import { BASEMAPS, getBasemap, subscribeBasemap, selectBasemap } from './basemaps.mjs';

const MAX_ZOOM = 19;

function CenterReporter({ mapState, pixelToLatLng, onCenterChange }) {
  const center = pixelToLatLng([mapState.width / 2, mapState.height / 2]);
  useLayoutEffect(() => { onCenterChange?.(center); }, [center[0], center[1], onCenterChange]);
  return null;
}

function MarkerLayer({ groups, clustering, mapState, latLngToPixel, onSelect, onExpand }) {
  const markers = clustering ? clusterGroups(groups, mapState.zoom) : groups.map(group => ({ ...group, count:group.people.length, clustered:false }));
  return <>{markers.map(marker => {
    const [x, y] = latLngToPixel([marker.lat, marker.lon]);
    const canExpand = marker.clustered && mapState.zoom < MAX_ZOOM;
    const label = marker.clustered
      ? canExpand ? `此區域共 ${marker.count} 位成員，點選放大` : [`此區域共 ${marker.count} 位成員`, ...marker.groups.map(group => `${group.label}：${group.people.map(p => p.name).join('、')}`)].join('\n')
      : `${marker.label}：${marker.people.map(p => p.name).join('、')}`;
    return <div key={marker.key} className="pigeon-click-block" style={{ position:'absolute', left:x - (marker.clustered ? 24 : 22), top:y - (marker.clustered ? 24 : 44) }}>
      <button type="button" className={`member-map-marker${marker.clustered ? ' member-map-cluster' : ''}`} aria-label={label} title={label}
        data-member-count={marker.count} data-location-count={marker.groups?.length || 1}
        onClick={() => { if (canExpand) onExpand(marker, mapState.zoom); else if (!marker.clustered) onSelect(marker.key); }}>
        <span>{marker.count > 1 || marker.clustered ? marker.count : '●'}</span>
      </button>
    </div>;
  })}</>;
}

function MemberMap({ groups, focusKey, onSelect, initialCenter = [23.7, 121], initialZoom = 7, picking = false, onCenterChange, clustering = true }) {
  const [clusterNearby, setClusterNearby] = useState(true);
  const basemapId = useSyncExternalStore(subscribeBasemap, getBasemap);
  const basemap = BASEMAPS[basemapId];
  const [tileError, setTileError] = useState(false);
  useEffect(() => { setTileError(false); }, [basemapId]);
  // Replace only tile images on a source change, preserving the map's live drag and zoom.
  const Tile = useMemo(() => function BasemapTile({ tile, tileLoaded }) {
    return <img src={tile.url} srcSet={tile.srcSet} width={tile.width} height={tile.height} loading="lazy" alt=""
      data-map-source={basemapId} onLoad={tileLoaded}
      onError={() => { if (getBasemap() === basemapId && tile.active) setTileError(true); tileLoaded(); }}
      style={{ position:'absolute', left:tile.left, top:tile.top, willChange:'transform', transformOrigin:'top left', opacity:1 }} />;
  }, [basemapId]);
  function focusedView() {
    const focused = groups.find(group => group.key === focusKey);
    if (focused) return { center:[focused.lat, focused.lon], zoom:15 };
    if (groups.length) {
      const latitudes = groups.map(g => g.lat), longitudes = groups.map(g => g.lon);
      const span = Math.max(Math.max(...latitudes) - Math.min(...latitudes), Math.max(...longitudes) - Math.min(...longitudes));
      return { center:[(Math.min(...latitudes) + Math.max(...latitudes)) / 2, (Math.min(...longitudes) + Math.max(...longitudes)) / 2],
        zoom:groups.length === 1 ? 14 : Math.max(2, Math.min(14, Math.floor(Math.log2(180 / Math.max(span, 0.01))) - 1)) };
    }
    return { center:initialCenter, zoom:initialZoom };
  }
  const [view, setView] = useState(() => ({ ...focusedView(), key:focusKey }));
  const currentView = view.key === focusKey ? view : { ...focusedView(), key:focusKey };
  // Remember a new focus immediately, before debounced bounds callbacks. Changing
  // correction modes may remove its marker without changing the map's view.
  useLayoutEffect(() => {
    setView(previous => previous.key === focusKey ? previous : currentView);
  }, [focusKey]);
  const { center, zoom } = currentView;
  const updateView = update => setView(previous => ({ ...update(previous.key === focusKey ? previous : currentView), key:focusKey }));
  const focusRef = useRef(focusKey);
  focusRef.current = focusKey;
  return <div tabIndex={0} role="group" aria-label={picking ? '指定位置地圖，方向鍵移動中央準星，加減鍵縮放' : '地圖，方向鍵移動，加減鍵縮放'} style={{ height:'100%', position:'relative', isolation:'isolate' }} onKeyDown={event => {
    if (event.target !== event.currentTarget) return;
    const step = 180 / 2 ** zoom;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      updateView(view => ({ ...view, center:[Math.max(-85, Math.min(85, view.center[0] + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))), ((view.center[1] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) + 540) % 360) - 180] }));
    } else if (['+','-','='].includes(event.key)) { event.preventDefault(); updateView(view => ({ ...view, zoom:Math.max(2, Math.min(MAX_ZOOM, view.zoom + (event.key === '-' ? -1 : 1))) })); }
  }}><Map key={focusKey} center={center} zoom={zoom} minZoom={2} maxZoom={MAX_ZOOM} animate={false}
    provider={basemap.provider} tileComponent={Tile}
    attributionPrefix={false} attribution={<span>{basemapId === 'satellite' && <><a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">© Google Maps</a> · 地點資料：</>}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></span>}
    onBoundsChanged={({ center, zoom }) => {
      // A replaced map may still deliver a delayed callback; it must not undo the new focus.
      if (focusRef.current === focusKey) updateView(() => ({ center, zoom }));
    }}>
    <CenterReporter onCenterChange={onCenterChange} />
    <MarkerLayer groups={groups} clustering={clustering && clusterNearby} onSelect={onSelect}
      onExpand={(marker, currentZoom) => updateView(() => ({ center:[marker.lat, marker.lon], zoom:Math.min(MAX_ZOOM, currentZoom + 2) }))} />
    <div className="member-map-zoom" role="group" aria-label="地圖縮放">
      <button type="button" aria-label="放大地圖" onClick={() => updateView(view => ({ ...view, zoom:Math.min(MAX_ZOOM, view.zoom + 1) }))}>＋</button>
      <button type="button" aria-label="縮小地圖" onClick={() => updateView(view => ({ ...view, zoom:Math.max(2, view.zoom - 1) }))}>−</button>
    </div>
  </Map><div className="member-map-basemaps" role="group" aria-label="地圖底圖">
    <button type="button" aria-label={BASEMAPS.osm.label} title={BASEMAPS.osm.label} aria-pressed={basemapId === 'osm'} onClick={() => selectBasemap('osm')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z M9 3v15 M15 6v15" /></svg>
    </button>
    <button type="button" aria-label={BASEMAPS.satellite.label} title={BASEMAPS.satellite.label} aria-pressed={basemapId === 'satellite'} onClick={() => selectBasemap('satellite')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 9 6 6 4-4-6-6-4 4Z M5 3l4 4-2 2-4-4 2-2Z M17 15l4 4-2 2-4-4 2-2Z M12 12l-3 3 M3 13a8 8 0 0 1 8 8 M3 17a4 4 0 0 1 4 4" /></svg>
    </button>
  </div>{clustering && <div className="member-map-clustering">
    <button type="button" aria-label="合併鄰近地點" title={clusterNearby ? '取消鄰近地點群組' : '開啟鄰近地點群組'} aria-pressed={clusterNearby} onClick={() => setClusterNearby(value => !value)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="5" r="3" /><circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" /><path d="m10.5 7.6-4 7.8 M13.5 7.6l4 7.8 M8 18h8" /></svg>
    </button>
  </div>}{tileError && <p className="member-map-tile-error" role="status">{basemap.label}部分底圖載入失敗，請切換底圖或稍後重開。</p>}
  {picking && <svg className="location-correction-crosshair" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="M24 3v12 M24 33v12 M3 24h12 M33 24h12 M24 16a8 8 0 1 0 0 16 8 8 0 0 0 0-16" fill="none" stroke="white" strokeWidth="6" />
    <path d="M24 3v12 M24 33v12 M3 24h12 M33 24h12 M24 16a8 8 0 1 0 0 16 8 8 0 0 0 0-16" fill="none" stroke="#b92332" strokeWidth="2.5" />
    <circle cx="24" cy="24" r="3" fill="#b92332" stroke="white" strokeWidth="1.5" />
  </svg>}</div>;
}

export function mount(container) {
  const root = createRoot(container);
  return { update: props => root.render(<MemberMap {...props} />), destroy: () => root.unmount() };
}
