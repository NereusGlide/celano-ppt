import { create } from "zustand";
import { persist,type PersistStorage,type StorageValue } from "zustand/middleware";

import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasAssistantSession,CanvasConnection,CanvasNodeData,ViewportTransform } from "@/types/canvas";
import { nanoid } from "nanoid";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let canvasStorageReadFailed = false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown) {
    return value === undefined || typeof value === "string";
}

function isNodeResult(value: unknown) {
    return isRecord(value) && typeof value.id === "string" && typeof value.status === "string" && typeof value.content === "string" && isOptionalString(value.storageKey);
}

function isCanvasNode(value: unknown) {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string" || typeof value.title !== "string" || !isRecord(value.position) || typeof value.position.x !== "number" || typeof value.position.y !== "number" || typeof value.width !== "number" || typeof value.height !== "number") return false;
    if (value.metadata === undefined) return true;
    const metadata = value.metadata;
    if (!isRecord(metadata)) return false;
    return isOptionalString(metadata.content) && isOptionalString(metadata.storageKey)
        && (metadata.references === undefined || Array.isArray(metadata.references) && metadata.references.every((url) => typeof url === "string"))
        && (metadata.images === undefined || Array.isArray(metadata.images) && metadata.images.every(isNodeResult))
        && (metadata.texts === undefined || Array.isArray(metadata.texts) && metadata.texts.every(isNodeResult));
}

function isCanvasConnection(value: unknown) {
    return isRecord(value) && typeof value.id === "string" && typeof value.fromNodeId === "string" && typeof value.toNodeId === "string";
}

function isCanvasAssistantMessage(value: unknown) {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.role !== "string" || typeof value.text !== "string") return false;
    return value.references === undefined || Array.isArray(value.references) && value.references.every((reference) => isRecord(reference) && typeof reference.id === "string" && typeof reference.type === "string" && typeof reference.title === "string" && isOptionalString(reference.dataUrl) && isOptionalString(reference.storageKey) && isOptionalString(reference.text));
}

function isCanvasAssistantSession(value: unknown) {
    return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string" && Array.isArray(value.messages) && value.messages.every(isCanvasAssistantMessage);
}

function isCanvasProject(value: unknown): value is CanvasProject {
    return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string" && Array.isArray(value.nodes) && value.nodes.every(isCanvasNode) && Array.isArray(value.connections) && value.connections.every(isCanvasConnection) && Array.isArray(value.chatSessions) && value.chatSessions.every(isCanvasAssistantSession) && (value.activeChatId === null || typeof value.activeChatId === "string") && (value.backgroundMode === "dots" || value.backgroundMode === "lines" || value.backgroundMode === "blank") && typeof value.showImageInfo === "boolean" && isRecord(value.viewport) && typeof value.viewport.x === "number" && typeof value.viewport.y === "number" && typeof value.viewport.k === "number";
}

function isDeletedProject(value: unknown): value is CanvasDeletedProject {
    return isRecord(value) && typeof value.id === "string" && typeof value.deletedAt === "string";
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        let parsed: StorageValue<CanvasStore>;
        try {
            parsed = JSON.parse(value) as StorageValue<CanvasStore>;
            if (!parsed?.state || typeof parsed.state !== "object" || !Array.isArray(parsed.state.projects) || !parsed.state.projects.every(isCanvasProject) || (parsed.state.deletedProjects !== undefined && (!Array.isArray(parsed.state.deletedProjects) || !parsed.state.deletedProjects.every(isDeletedProject)))) throw new Error("画布缓存结构无效");
            // 旧版缓存尚未记录 deletedProjects，继续按空删除记录恢复。
            parsed.state.deletedProjects ??= [];
            canvasStorageReadFailed = false;
        } catch {
            canvasStorageReadFailed = true;
            console.warn("画布缓存读取失败，原始数据已保留");
            return null;
        }
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (canvasStorageReadFailed && !nextState.projects.length && !nextState.deletedProjects.length) return;
        canvasStorageReadFailed = false;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const nodeIds = new Set(state.projects.filter(project => removing.has(project.id)).flatMap(project => project.nodes.map(node => node.id)));
                    void import('@/stores/use-asset-store').then(({ useAssetStore }) => {
                        const store = useAssetStore.getState();
                        for (const asset of store.assets) {
                            if ((typeof asset.metadata?.projectId === 'string' && removing.has(asset.metadata.projectId)) || (typeof asset.metadata?.nodeId === 'string' && nodeIds.has(asset.metadata.nodeId))) store.removeAsset(asset.id);
                        }
                    });
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
