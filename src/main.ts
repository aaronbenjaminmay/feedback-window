figma.showUI(__html__, { width: 960, height: 720 });

const figmaRuntime = figma as typeof figma & {
  fileKey?: string;
};

const getCurrentFileKey = () => {
  if (typeof figmaRuntime.fileKey === "string") {
    return figmaRuntime.fileKey;
  }

  // Figma does not expose a second stable file key on figma.root or document
  // plugin data. Keep the UI fallback for runtimes where figma.fileKey is absent.
  return "";
};

const currentFileKey = getCurrentFileKey();

figma.ui.postMessage({
  type: "current-file-key",
  data: {
    fileKey: currentFileKey
  }
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === "save-settings") {
    figma.root.setPluginData("settings", JSON.stringify(msg.data));
  }

  if (msg.type === "get-settings") {
    const data = figma.root.getPluginData("settings");
    figma.ui.postMessage({ type: "settings", data });
  }

  if (msg.type === "save-tasks") {
    figma.root.setPluginData("tasks", JSON.stringify(msg.data));
  }

  if (msg.type === "get-tasks") {
    const data = figma.root.getPluginData("tasks");
    figma.ui.postMessage({ type: "tasks", data });
  }

  if (msg.type === "clear-tasks") {
    figma.root.setPluginData("tasks", "");
  }
};
