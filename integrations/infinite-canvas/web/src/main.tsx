import "antd/dist/reset.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "streamdown/styles.css";
import "./styles/globals.css";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initializeCelano } from "@/lib/celano-integration";
import { router } from "@/router";

await initializeCelano();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);

window.parent.postMessage({ type: "celano-canvas-ready" }, location.origin);
