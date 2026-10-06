export type LibraryChange = {
  resource: 'ppt' | 'asset';
  action: 'saved' | 'deleted';
  id: string;
};

const EVENT = 'celano-library-change';
const CHANNEL = 'celano-library';

function valid(value: unknown): value is LibraryChange {
  const event = value as LibraryChange;
  return !!event && ['ppt', 'asset'].includes(event.resource) && ['saved', 'deleted'].includes(event.action) && typeof event.id === 'string';
}

/** Refresh lists across pages, tabs and the canvas iframe without reloading the website. */
export function publishLibraryChange(change: LibraryChange) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: change }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(change);
    channel.close();
  }
}

export function subscribeLibraryChanges(listener: (change: LibraryChange) => void) {
  const local = (event: Event) => { const data = (event as CustomEvent).detail; if (valid(data)) listener(data); };
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  if (channel) channel.onmessage = event => { if (valid(event.data)) listener(event.data); };
  window.addEventListener(EVENT, local);
  return () => { window.removeEventListener(EVENT, local); channel?.close(); };
}
