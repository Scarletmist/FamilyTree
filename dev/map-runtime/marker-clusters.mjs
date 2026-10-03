// Web Mercator pixel distances keep clustering consistent with the visible zoom level.
export function clusterGroups(groups, zoom, radius = 72) {
  const world = 256 * 2 ** zoom;
  const points = groups.map(group => {
    const lat = Math.max(-85.05112878, Math.min(85.05112878, group.lat)) * Math.PI / 180;
    const lon = ((group.lon + 180) % 360 + 360) % 360;
    return { group, x:lon / 360 * world, y:(1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2 * world };
  });
  const parents = points.map((_, index) => index), grid = new Map();
  function root(index) { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; }
  points.forEach((point, index) => {
    const cellY = Math.floor(point.y / radius);
    for (const x of [point.x, point.x - world, point.x + world]) {
      const cellX = Math.floor(x / radius);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${cellX + dx},${cellY + dy}`) || []) {
          const difference = Math.abs(point.x - points[other].x), horizontal = Math.min(difference, world - difference);
          if (horizontal ** 2 + (point.y - points[other].y) ** 2 <= radius ** 2) parents[root(index)] = root(other);
        }
      }
    }
    const key = `${Math.floor(point.x / radius)},${cellY}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  });
  const clusters = new Map();
  points.forEach((point, index) => {
    const key = root(index);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(point);
  });
  return [...clusters.values()].map(members => {
    const entries = members.map(point => point.group), count = entries.reduce((sum, group) => sum + group.people.length, 0);
    if (members.length === 1) return { ...entries[0], count, groups:entries, clustered:false };
    const origin = members[0].x;
    const x = members.reduce((sum, point) => sum + origin + ((point.x - origin + world / 2 + world) % world - world / 2), 0) / members.length;
    const y = members.reduce((sum, point) => sum + point.y, 0) / members.length;
    return { key:'cluster:' + entries.map(group => group.key).sort().join('|'), count, groups:entries, clustered:true,
      lon:((x / world * 360) % 360 + 360) % 360 - 180,
      lat:Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world))) * 180 / Math.PI };
  });
}
