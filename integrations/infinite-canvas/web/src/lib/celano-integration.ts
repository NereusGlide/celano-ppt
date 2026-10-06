import { pixelResolution } from "../../../../../src/shared/imageSpecs.js";
import { initializeAssetSync } from "@/services/api/celano-assets";
import { encodeChannelModel,modelOptionsFromChannels,useConfigStore,type ModelChannel } from "@/stores/use-config-store";
import { Modal } from "antd";
import axios,{ CanceledError } from "axios";

export async function initializeCelano() {
    axios.interceptors.request.use(async request => {
        if (!request.url?.startsWith(location.origin + "/api/canvas/image/v1/images/")) return request;
        const data = request.data instanceof FormData ? Object.fromEntries(request.data.entries()) : request.data || {};
        const resolution = pixelResolution(String(data.size || "")) || "2K";
        if (request.data instanceof FormData) request.data.set("resolution", resolution);
        else if (request.data && typeof request.data === "object") request.data.resolution = resolution;
        const response = await fetch("/api/canvas/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: data.n, size: data.size, quality: data.quality, resolution, editing: request.url.endsWith("/edits") }) });
        const quote = await response.json();
        if (!response.ok) throw new Error(quote.error?.message || quote.error || "请先登录后生成");
        const confirmed = await new Promise<boolean>(resolve => Modal.confirm({ title: "确认本次画布生成", content: `${quote.resolution} 画质。本次 ${quote.count} 张，每张 ${quote.unit} 点，共消耗 ${quote.cost} 点。当前余额 ${quote.credits} 点。`, okText: "确认生成", cancelText: "取消", onOk: () => resolve(true), onCancel: () => resolve(false) }));
        if (!confirmed || request.signal?.aborted) throw new CanceledError("已取消生成");
        return request;
    });
    try {
        const response = await fetch("/api/canvas/config");
        if (!response.ok) throw new Error("加载模型配置失败");
        const data = await response.json();
        const config = useConfigStore.getState().config;
        const channels: ModelChannel[] = data.channels.map((channel: ModelChannel) => ({ ...channel, baseUrl: location.origin + channel.baseUrl }));
        // Preserve user-defined channels; refresh server-managed aliases without exposing keys.

        const image = channels.find(channel => channel.models.some(model => model.capability === "image"));
        const text = channels.find(channel => channel.models.some(model => model.capability === "text"));
        useConfigStore.setState({ config: { ...config, channels, models: modelOptionsFromChannels(channels),
            model: image ? encodeChannelModel(image.id, image.models[0].name) : "",
            imageModel: image ? encodeChannelModel(image.id, image.models[0].name) : "",
            textModel: text ? encodeChannelModel(text.id, text.models[0].name) : "",
            videoModel: "", audioModel: "", proxyEnabled: false } });
        await initializeAssetSync();
    } catch (error) {
        console.error("CELANO 画布配置加载失败", error);
        // Keep the original settings dialog available for retry or user channels.
    }
}
