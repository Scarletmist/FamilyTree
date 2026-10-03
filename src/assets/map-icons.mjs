const paths = {
  correct: 'M12 21s-7-5.2-7-11a7 7 0 0 1 14 0 M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M14 18l5-5 2 2-5 5-3 1 1-3Z',
  edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5Z',
  retry: 'M20 7v5h-5 M4 17v-5h5 M6.1 6.1A8 8 0 0 1 20 12 M4 12a8 8 0 0 0 13.9 5.9',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M16 16l5 5',
  pick: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10',
  save: 'M5 12l4 4L19 6',
  cancel: 'M18 6 6 18 M6 6l12 12',
  takeover: 'M4 7h14 M14 3l4 4-4 4 M20 17H6 M10 13l-4 4 4 4',
  back: 'm15 6-6 6 6 6',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01'
};
export function setMapIcon(button, name, label) {
  button.classList.add('map-icon-button');
  button.setAttribute('aria-label', label); button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]}" /></svg>`;
  return button;
}
export function mapIconButton(name, label) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'plain-button';
  return setMapIcon(button, name, label);
}
