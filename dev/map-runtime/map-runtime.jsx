import React, { useState, useLayoutEffect, useRef, useMemo, useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { Map } from 'pigeon-maps';
import { clusterGroups } from './marker-clusters.mjs';
import { BASEMAPS, getBasemap, subscribeBasemap, selectBasemap } from './basemaps.mjs';
import { centerForVisiblePoint } from './view-geometry.mjs';

const MAX_ZOOM = 19;
export { centerForVisiblePoint };

function CenterReporter({ mapState, pixelToLatLng, onCenterChange, liveView, committedView, bottomInset }) {
  const center = pixelToLatLng([mapState.width / 2, (mapState.height - bottomInset) / 2]);
  useLayoutEffect(() => {
    liveView.current = { center:pixelToLatLng([mapState.width / 2, mapState.height / 2]), visibleCenter:center, zoom:mapState.zoom };
    committedView.current = { center:mapState.center, zoom:mapState.zoom };
  });
  useLayoutEffect(() => { onCenterChange?.(center); }, [center[0], center[1], onCenterChange]);
  return null;
}

function MarkerLayer({ groups, clustering, mapState, latLngToPixel, onSelect, onExpand, onCluster, selectedKey }) {
  const markers = useMemo(() => clustering ? clusterGroups(groups, mapState.zoom) : groups.map(group => ({ ...group, count:group.people.length, clustered:false })), [groups, clustering, mapState.zoom]);
  return <>{markers.map(marker => {
    const [x, y] = latLngToPixel([marker.lat, marker.lon]);
    const canExpand = marker.clustered && mapState.zoom < MAX_ZOOM;
    const label = marker.clustered
      ? canExpand ? `此區域共 ${marker.count} 位成員，點選放大` : [`此區域共 ${marker.count} 位成員`, ...marker.groups.map(group => `${group.label}：${group.people.map(p => p.name).join('、')}`)].join('\n')
      : `${marker.label}：${marker.people.map(p => p.name).join('、')}`;
    return <div key={marker.key} className="pigeon-click-block pigeon-drag-block" style={{ position:'absolute', left:x - (marker.clustered ? 24 : 22), top:y - (marker.clustered ? 24 : 44) }}>
      <button type="button" className={`member-map-marker${marker.clustered ? ' member-map-cluster' : ''}`} aria-label={label} title={label}
        aria-pressed={marker.key === selectedKey || Boolean(marker.groups?.some(group => group.key === selectedKey))}
        data-member-count={marker.count} data-location-count={marker.groups?.length || 1}
        onClick={() => { if (canExpand) onExpand(marker, mapState.zoom); else if (marker.clustered) onCluster(marker, [x, y]); else onSelect?.(marker.key); }}>
        <span>{marker.count > 1 || marker.clustered ? marker.count : '●'}</span>
      </button>
    </div>;
  })}</>;
}

function MemberMap({ groups, focusKey, selectedKey = focusKey, onSelect, onCluster, initialCenter = [23.7, 121], initialZoom = 7, picking = false, onCenterChange, clustering = true, bottomInset = 0, viewRequest, viewRef, overlayHost }) {
  const liveView = useRef({ center:initialCenter, visibleCenter:initialCenter, zoom:initialZoom });
  const committedView = useRef({ center:initialCenter, zoom:initialZoom }), pointers = useRef(new Set());
  useEffect(() => {
    const release = event => pointers.current.delete(event.pointerId);
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
  }, []);
  const [clusterNearby, setClusterNearby] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [clusterPopup, setClusterPopup] = useState(null);
  const shell = useRef(null), layersButton = useRef(null), layersPanel = useRef(null);
  useEffect(() => {
    if (!layersOpen && !clusterPopup) return;
    const dismiss = event => {
      if (!event.target.closest?.('.member-map-layers, .member-map-layer-options, .member-map-cluster-popup, .member-map-marker')) { setLayersOpen(false); setClusterPopup(null); }
    };
    document.addEventListener('pointerdown', dismiss);
    if (layersOpen) layersPanel.current?.querySelector('button')?.focus({ preventScroll:true });
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [layersOpen, clusterPopup]);
  useEffect(() => { setClusterPopup(null); setLayersOpen(false); }, [focusKey, picking, clustering]);
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
  function focusedView(minimumZoom = 15) {
    const focused = groups.find(group => group.key === focusKey);
    if (focused) { const zoom = Math.min(MAX_ZOOM, Math.max(15, minimumZoom)); return { center:centerForVisiblePoint([focused.lat, focused.lon], zoom, bottomInset), zoom }; }
    if (groups.length) {
      const latitudes = groups.map(g => g.lat), longitudes = groups.map(g => g.lon);
      const span = Math.max(Math.max(...latitudes) - Math.min(...latitudes), Math.max(...longitudes) - Math.min(...longitudes));
      const zoom = groups.length === 1 ? 14 : Math.max(2, Math.min(14, Math.floor(Math.log2(180 / Math.max(span, 0.01))) - 1));
      return { center:centerForVisiblePoint([(Math.min(...latitudes) + Math.max(...latitudes)) / 2, (Math.min(...longitudes) + Math.max(...longitudes)) / 2], zoom, bottomInset), zoom };
    }
    return { center:initialCenter, zoom:initialZoom };
  }
  const requestKey = viewRequest?.token;
  function requestedView() {
    return viewRequest?.view ? viewRequest.view : focusedView(liveView.current.zoom);
  }
  const [view, setView] = useState(() => ({ ...requestedView(), key:focusKey, requestKey }));
  const currentView = view.key === focusKey && view.requestKey === requestKey ? view : { ...requestedView(), key:focusKey, requestKey };
  // Remember a new focus immediately, before debounced bounds callbacks. Changing
  // correction modes may remove its marker without changing the map's view.
  useLayoutEffect(() => {
    setView(previous => previous.key === focusKey && previous.requestKey === requestKey ? previous : currentView);
  }, [focusKey, requestKey]);
  const { center, zoom } = currentView;
  const updateView = update => setView(previous => ({ ...update(previous.key === focusKey && previous.requestKey === requestKey ? previous : currentView), key:focusKey, requestKey }));
  const changeZoom = delta => {
    setClusterPopup(null);
    updateView(view => {
      const zoom = Math.max(2, Math.min(MAX_ZOOM, view.zoom + delta));
      return { center:centerForVisiblePoint(liveView.current.visibleCenter, zoom, bottomInset), zoom };
    });
  };
  useLayoutEffect(() => { if (viewRef) viewRef.current = () => structuredClone(liveView.current); });
  return <div ref={shell} tabIndex={0} role="group" aria-label={picking ? '指定位置地圖，方向鍵移動中央準星，加減鍵縮放' : '地圖，方向鍵移動，加減鍵縮放'} style={{ height:'100%', position:'relative', isolation:'isolate', '--map-bottom-inset':`${bottomInset}px` }} onPointerDownCapture={event => { if (!event.target.closest('.pigeon-drag-block')) pointers.current.add(event.pointerId); }} onKeyDown={event => {
    if (event.key === 'Escape' && (layersOpen || clusterPopup)) { event.preventDefault(); event.stopPropagation(); setLayersOpen(false); setClusterPopup(null); layersButton.current?.focus({ preventScroll:true }); return; }
    if (event.target !== event.currentTarget) return;
    const step = 180 / 2 ** zoom;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      updateView(view => ({ ...view, center:[Math.max(-85, Math.min(85, view.center[0] + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))), ((view.center[1] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) + 540) % 360) - 180] }));
    } else if (['+','-','='].includes(event.key)) { event.preventDefault(); changeZoom(event.key === '-' ? -1 : 1); }
  }}><Map center={center} zoom={zoom} minZoom={2} maxZoom={MAX_ZOOM} animate={false}
    provider={basemap.provider} tileComponent={Tile}
    attributionPrefix={false} attribution={<span>{basemapId === 'satellite' && <><a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">© Google Maps</a> · 地點資料：</>}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></span>}
    onBoundsChanged={() => {
      // Debounced callbacks may belong to an earlier focus or drag. Read the
      // current committed view; a live drag offset must not be applied twice.
      if (pointers.current.size) return;
      const { center, zoom } = committedView.current;
      updateView(() => ({ center, zoom }));
    }}>
    <CenterReporter onCenterChange={onCenterChange} liveView={liveView} committedView={committedView} bottomInset={bottomInset} />
    <MarkerLayer groups={groups} clustering={clustering && clusterNearby} onSelect={onSelect} selectedKey={selectedKey}
      onCluster={(marker, point) => { setClusterPopup({ marker, point }); onCluster?.(marker.groups.map(group => group.key)); }}
      onExpand={(marker, currentZoom) => { setClusterPopup(null); const zoom = Math.min(MAX_ZOOM, currentZoom + 2); updateView(() => ({ center:centerForVisiblePoint([marker.lat, marker.lon], zoom, bottomInset), zoom })); }} />
  </Map><div className="member-map-controls pigeon-drag-block"><div className="member-map-layers">
    <button ref={layersButton} type="button" className="map-icon-button" aria-label="底圖與群組設定" title="底圖與群組設定" aria-expanded={layersOpen} aria-controls="member-map-layer-options" onClick={() => { setLayersOpen(value => !value); setClusterPopup(null); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5" /></svg>
    </button>
    {layersOpen && createPortal(<div ref={layersPanel} id="member-map-layer-options" className="member-map-layer-options pigeon-drag-block" role="group" aria-label="底圖與顯示設定" style={{ left:Math.max(12, (shell.current?.clientWidth || 360) - 340), right:'auto' }}>
      <h3>地圖顯示</h3>
      {Object.entries(BASEMAPS).map(([id, source]) => <button key={id} type="button" aria-pressed={basemapId === id} onClick={() => selectBasemap(id)}><span>{source.label}</span><span aria-hidden="true">{basemapId === id ? '✓' : ''}</span></button>)}
      {clustering && <button type="button" className="member-map-group-option" aria-label="合併鄰近地點" aria-pressed={clusterNearby} onClick={() => { setClusterNearby(value => !value); setClusterPopup(null); }}><span>合併鄰近標記</span><span aria-hidden="true">{clusterNearby ? '✓' : ''}</span></button>}
      <p className="member-map-legend"><span />手動修正位置</p>
    </div>, overlayHost)}
  </div><div className="member-map-zoom" role="group" aria-label="地圖縮放">
    <button type="button" aria-label="放大地圖" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(1)}>＋</button>
    <button type="button" aria-label="縮小地圖" disabled={zoom <= 2} onClick={() => changeZoom(-1)}>−</button>
  </div></div>{clusterPopup && <div className="member-map-cluster-popup pigeon-drag-block" role="region" aria-label="此區域的所在地與成員" style={{ left:Math.max(12, Math.min(clusterPopup.point[0] - 138, (shell.current?.clientWidth || 300) - 288)), top:Math.max(12, Math.min(clusterPopup.point[1] + 30, (shell.current?.clientHeight || 400) - bottomInset - 220)) }}>
    <div className="member-map-popup-heading"><h3>此區域共 {clusterPopup.marker.count} 位成員</h3><button type="button" aria-label="關閉區域清單" className="map-icon-button" onClick={() => { setClusterPopup(null); shell.current?.focus({ preventScroll:true }); }}>×</button></div>
    {clusterPopup.marker.groups.map(group => <section key={group.key}><h4>{group.label}</h4>{group.people.map(person => <button key={person.id || person.name} type="button" onClick={() => { setClusterPopup(null); onSelect?.(group.key); }}>{person.name}<span aria-hidden="true">›</span></button>)}</section>)}
  </div>}{tileError && <div className="member-map-tile-error pigeon-drag-block" role="status"><span>{basemap.label}部分底圖載入失敗</span><button type="button" onClick={() => { selectBasemap('osm'); setTileError(false); }}>切回街道圖</button></div>}
  {picking && <svg className="location-correction-crosshair" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="M24 3v12 M24 33v12 M3 24h12 M33 24h12 M24 16a8 8 0 1 0 0 16 8 8 0 0 0 0-16" fill="none" stroke="white" strokeWidth="6" />
    <path d="M24 3v12 M24 33v12 M3 24h12 M33 24h12 M24 16a8 8 0 1 0 0 16 8 8 0 0 0 0-16" fill="none" stroke="#b92332" strokeWidth="2.5" />
    <circle cx="24" cy="24" r="3" fill="#b92332" stroke="white" strokeWidth="1.5" />
  </svg>}</div>;
}

export function mount(container) {
  const root = createRoot(container);
  const viewRef = { current:null };
  const overlayHost = container.closest('.member-map-body') || container;
  return { update: props => flushSync(() => root.render(<MemberMap {...props} viewRef={viewRef} overlayHost={overlayHost} />)), snapshot: () => viewRef.current?.(), destroy: () => root.unmount() };
}
