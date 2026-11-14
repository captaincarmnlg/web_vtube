const KEY = 'web_vtube_settings';
export const defaults = {
  powerPreference: 'default', antialias: true, pixelRatio: 0,
  outputBgType: 'green', outputBgColor: '#00b140', outputBgImage: ''
};

export function loadSettings() {
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { ...defaults }; }
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify({ ...defaults, ...s }));
}
