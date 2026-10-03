import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Map, Overlay } from 'pigeon-maps';

function MemberMap({ groups, focusKey, onSelect, tileUrl }) {
  const [center, setCenter] = useState([23.7, 121]);
  const [zoom, setZoom] = useState(7);
  useEffect(() => {
    const focused = groups.find(group => group.key === focusKey);
    if (focused) { setCenter([focused.lat, focused.lon]); setZoom(15); }
    else if (groups.length) {
      const latitudes = groups.map(g => g.lat), longitudes = groups.map(g => g.lon);
      setCenter([(Math.min(...latitudes) + Math.max(...latitudes)) / 2, (Math.min(...longitudes) + Math.max(...longitudes)) / 2]);
      const span = Math.max(Math.max(...latitudes) - Math.min(...latitudes), Math.max(...longitudes) - Math.min(...longitudes));
      setZoom(groups.length === 1 ? 14 : Math.max(2, Math.min(14, Math.floor(Math.log2(180 / Math.max(span, 0.01))) - 1)));
    }
  }, [focusKey]);
  return <div tabIndex={0} role="group" aria-label="地圖，方向鍵移動，加減鍵縮放" style={{ height: '100%' }} onKeyDown={event => {
    if (event.target !== event.currentTarget) return;
    const step = 180 / 2 ** zoom;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      setCenter(([lat, lon]) => [Math.max(-85, Math.min(85, lat + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))), ((lon + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) + 540) % 360) - 180]);
    } else if (['+','-','='].includes(event.key)) { event.preventDefault(); setZoom(z => Math.max(2, Math.min(19, z + (event.key === '-' ? -1 : 1)))); }
  }}><Map center={center} zoom={zoom} minZoom={2} maxZoom={19} animate={false}
    provider={(x, y, z) => tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y)}
    attributionPrefix={false} attribution={<span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></span>}
    onBoundsChanged={({ center, zoom }) => { setCenter(center); setZoom(zoom); }}>
    {groups.map(group => <Overlay key={group.key} anchor={[group.lat, group.lon]} offset={[22, 44]}>
      <button type="button" className="member-map-marker" aria-label={`${group.label}：${group.people.map(p => p.name).join('、')}`}
        title={group.label} onClick={() => onSelect(group.key)}><span>{group.people.length > 1 ? group.people.length : '●'}</span></button>
    </Overlay>)}
    <div className="member-map-zoom" role="group" aria-label="地圖縮放">
      <button type="button" aria-label="放大地圖" onClick={() => setZoom(z => Math.min(19, z + 1))}>＋</button>
      <button type="button" aria-label="縮小地圖" onClick={() => setZoom(z => Math.max(2, z - 1))}>−</button>
    </div>
  </Map></div>;
}

export function mount(container) {
  const root = createRoot(container);
  return { update: props => root.render(<MemberMap {...props} />), destroy: () => root.unmount() };
}
