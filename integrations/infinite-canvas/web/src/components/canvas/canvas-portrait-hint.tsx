import { X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "celano-canvas-portrait-hint";
const PORTRAIT_QUERY = "(max-width: 768px) and (orientation: portrait)";

function readDismissed() {
    try {
        return sessionStorage.getItem(STORAGE_KEY) === "0";
    } catch {
        return false;
    }
}

/** 竖屏弱提示。关闭后本次会话不再出现，且不覆盖顶栏与底栏工具。 */
export function CanvasPortraitHint() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const media = window.matchMedia(PORTRAIT_QUERY);
        const sync = () => setVisible(media.matches && !readDismissed());
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    if (!visible) return null;

    const dismiss = () => {
        try {
            sessionStorage.setItem(STORAGE_KEY, "0");
        } catch {
            /* 隐私模式仍允许本次关闭 */
        }
        setVisible(false);
    };

    return (
        <div className="canvas-portrait-hint" role="status">
            <p>建议横屏创作或使用桌面完整编辑</p>
            <button type="button" onClick={dismiss} aria-label="关闭提示">
                <X className="size-4" />
            </button>
        </div>
    );
}
