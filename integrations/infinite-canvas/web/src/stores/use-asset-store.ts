import { create } from "zustand";
import { persist,type PersistStorage,type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedMedia,resolveMediaUrl } from "@/services/file-storage";
import { cleanupUnusedImages,ensureImagePreview,previewUrlFor,resolveImageUrl,uploadImage } from "@/services/image-storage";
import { nanoid } from "nanoid";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let assetStorageReadFailed = false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAsset(value: unknown): value is Asset {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string" || typeof value.title !== "string" || typeof value.coverUrl !== "string" || !Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string") || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !isRecord(value.data)) return false;
    if (value.kind === "text") return typeof value.data.content === "string";
    if (value.kind === "image") return typeof value.data.dataUrl === "string" && typeof value.data.width === "number" && typeof value.data.height === "number" && typeof value.data.bytes === "number" && typeof value.data.mimeType === "string" && (value.data.storageKey === undefined || typeof value.data.storageKey === "string");
    if (value.kind === "video") return typeof value.data.url === "string" && typeof value.data.width === "number" && typeof value.data.height === "number" && typeof value.data.bytes === "number" && typeof value.data.mimeType === "string" && (value.data.storageKey === undefined || typeof value.data.storageKey === "string");
    return false;
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        let parsed: StorageValue<AssetStore>;
        try {
            parsed = JSON.parse(value) as StorageValue<AssetStore>;
            if (!parsed?.state || typeof parsed.state !== "object" || !Array.isArray(parsed.state.assets) || !parsed.state.assets.every(isAsset)) throw new Error("素材缓存结构无效");
            assetStorageReadFailed = false;
        } catch {
            assetStorageReadFailed = true;
            console.warn("素材缓存读取失败，原始数据已保留");
            return null;
        }
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: (name, value) => {
        // hydration 只更新 hydrated 标记，不能把损坏原文覆盖成空集合。
        if (assetStorageReadFailed && !value.state.assets.length) return;
        assetStorageReadFailed = false;
        return localForageStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
