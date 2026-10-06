const owner = new URLSearchParams(location.search).get("owner") || sessionStorage.getItem("celano_canvas_owner") || "guest";
sessionStorage.setItem("celano_canvas_owner", owner);
export const canvasDatabase = "celano-infinite-canvas:" + owner;
