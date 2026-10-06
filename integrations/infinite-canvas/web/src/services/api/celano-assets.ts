import { getImageBlob } from '@/services/image-storage';
import { useAssetStore,type Asset } from '@/stores/use-asset-store';
import { publishLibraryChange, subscribeLibraryChanges } from '../../../../../../src/shared/libraryEvents.js';

async function api(path: string, init?: RequestInit) {
    const response = await fetch('/api/canvas/assets' + path, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || result.error || '素材同步失败');
    return result;
}

async function serialize(asset: Asset) {
    if (asset.kind !== 'text' && asset.kind !== 'image') throw new Error('画布只支持文本和图片素材');
    if (asset.kind === 'text') return asset;
    const blob = asset.data.storageKey ? await getImageBlob(asset.data.storageKey) : null;
    const image = blob || await (await fetch(asset.data.dataUrl)).blob();
    const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(image);
    });
    return { ...asset, imageData };
}

let queue = Promise.resolve();
let pending = 0;
let applyingRemote = false;
let initialized = false;
export async function initializeAssetSync() {
    if (initialized || sessionStorage.getItem('celano_canvas_owner') === 'guest') return;
    await useAssetStore.persist.rehydrate();
    const { assets } = await api('');
    useAssetStore.setState({ assets, hydrated: true });
    initialized = true;
    const refresh = () => {
        queue = queue.then(async () => {
            const { assets } = await api('');
            applyingRemote = true;
            try { useAssetStore.setState({ assets }); }
            finally { applyingRemote = false; }
        }).catch(error => { window.dispatchEvent(new CustomEvent('celano-canvas-asset-error', { detail: error.message })); });
    };
    subscribeLibraryChanges(change => { if (change.resource === 'asset') refresh(); });
    window.addEventListener('focus', refresh);
    useAssetStore.subscribe((state, previous) => {
        if (applyingRemote || state.assets === previous.assets) return;
        const before = new Map(previous.assets.map(asset => [asset.id, asset]));
        const after = new Map(state.assets.map(asset => [asset.id, asset]));
        const changes = state.assets.filter(asset => asset.kind !== 'video' && before.get(asset.id) !== asset);
        const removed = previous.assets.filter(asset => !after.has(asset.id));
        pending++;
        window.parent.postMessage({ type: 'celano-canvas-saving', saving: true }, location.origin);
        queue = queue.then(async () => {
            for (const asset of changes) {
                await api('/' + encodeURIComponent(asset.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await serialize(asset)) });
                publishLibraryChange({ resource: 'asset', action: 'saved', id: asset.id });
            }
            for (const asset of removed) {
                await api('/' + encodeURIComponent(asset.id), { method: 'DELETE' });
                publishLibraryChange({ resource: 'asset', action: 'deleted', id: asset.id });
            }
        }).catch(error => { window.dispatchEvent(new CustomEvent('celano-canvas-asset-error', { detail: error.message })); }).finally(() => {
            pending--;
            if (!pending) window.parent.postMessage({ type: 'celano-canvas-saving', saving: false }, location.origin);
        });
    });
}
