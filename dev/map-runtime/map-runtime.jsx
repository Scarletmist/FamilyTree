import React, { useState, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Map, Overlay } from 'pigeon-maps';

function CenterReporter({ mapState, pixelToLatLng, onCenterChange }) {
  const center = pixelToLatLng([mapState.width / 2, mapState.height / 2]);
  useLayoutEffect(() => { onCenterChange?.(center); }, [center[0], center[1], onCenterChange]);
  return null;
}

function MemberMap({ groups, focusKey, onSelect, tileUrl, initialCenter = [23.7, 121], initialZoom = 7, picking = false, onCenterChange }) {
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
  const { center, zoom } = currentView;
  const updateView = update => setView(previous => ({ ...update(previous.key === focusKey ? previous : currentView), key:focusKey }));
  const focusRef = useRef(focusKey);
  focusRef.current = focusKey;
  return <div tabIndex={0} role="group" aria-label={picking ? '指定位置地圖，方向鍵移動中央準星，加減鍵縮放' : '地圖，方向鍵移動，加減鍵縮放'} style={{ height: '100%' }} onKeyDown={event => {
    if (event.target !== event.currentTarget) return;
    const step = 180 / 2 ** zoom;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      updateView(view => ({ ...view, center:[Math.max(-85, Math.min(85, view.center[0] + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))), ((view.center[1] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) + 540) % 360) - 180] }));
    } else if (['+','-','='].includes(event.key)) { event.preventDefault(); updateView(view => ({ ...view, zoom:Math.max(2, Math.min(19, view.zoom + (event.key === '-' ? -1 : 1))) })); }
  }}><Map key={focusKey} center={center} zoom={zoom} minZoom={2} maxZoom={19} animate={false}
    provider={(x, y, z) => tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y)}
    attributionPrefix={false} attribution={<span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></span>}
    onBoundsChanged={({ center, zoom }) => {
      // A replaced map may still deliver a delayed callback; it must not undo the new focus.
      if (focusRef.current === focusKey) updateView(() => ({ center, zoom }));
    }}>
    <CenterReporter onCenterChange={onCenterChange} />
    {groups.map(group => <Overlay key={group.key} anchor={[group.lat, group.lon]} offset={[22, 44]}>
      <button type="button" className="member-map-marker" aria-label={`${group.label}：${group.people.map(p => p.name).join('、')}`}
        title={group.label} onClick={() => onSelect(group.key)}><span>{group.people.length > 1 ? group.people.length : '●'}</span></button>
    </Overlay>)}
    <div className="member-map-zoom" role="group" aria-label="地圖縮放">
      <button type="button" aria-label="放大地圖" onClick={() => updateView(view => ({ ...view, zoom:Math.min(19, view.zoom + 1) }))}>＋</button>
      <button type="button" aria-label="縮小地圖" onClick={() => updateView(view => ({ ...view, zoom:Math.max(2, view.zoom - 1) }))}>−</button>
    </div>
  </Map>{picking && <div className="location-correction-crosshair" aria-hidden="true"><span /></div>}</div>;
}

export function mount(container) {
  const root = createRoot(container);
  return { update: props => root.render(<MemberMap {...props} />), destroy: () => root.unmount() };
}
