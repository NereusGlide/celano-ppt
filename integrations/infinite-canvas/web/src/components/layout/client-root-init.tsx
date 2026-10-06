import { App } from 'antd';
import type { ReactNode } from "react";
import { useEffect } from 'react';
export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    useEffect(() => {
        const config = () => void message.warning('模型由管理后台统一配置，请联系管理员检查图片或文本接口');
        const asset = (event: Event) => void message.error('素材保存失败：' + (event as CustomEvent).detail);
        window.addEventListener('celano-canvas-config-required', config);
        window.addEventListener('celano-canvas-asset-error', asset);
        return () => { window.removeEventListener('celano-canvas-config-required', config); window.removeEventListener('celano-canvas-asset-error', asset); };
    }, [message]);
    return <>{children}</>;
}
