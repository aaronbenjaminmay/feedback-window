import type { FeedbackSettings, Task } from "../types";

const requestPluginData = <DataType,>(
  requestType: string,
  responseType: string,
  emptyValue: DataType
) => {
  return new Promise<DataType>((resolve) => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data.pluginMessage;

      if (msg.type === responseType) {
        window.removeEventListener("message", handleMessage);
        resolve(msg.data ? JSON.parse(msg.data) : emptyValue);
      }
    };

    window.addEventListener("message", handleMessage);
    parent.postMessage({ pluginMessage: { type: requestType } }, "*");
  });
};

export const getSettings = () => {
  return requestPluginData<Partial<FeedbackSettings>>(
    "get-settings",
    "settings",
    {}
  );
};

export const saveSettings = (data: FeedbackSettings) => {
  parent.postMessage(
    { pluginMessage: { type: "save-settings", data } },
    "*"
  );
};

export const getTasks = () => {
  return requestPluginData<Task[]>("get-tasks", "tasks", []);
};

export const saveTasks = (data: Task[]) => {
  parent.postMessage({ pluginMessage: { type: "save-tasks", data } }, "*");
};

export const clearTasks = () => {
  parent.postMessage({ pluginMessage: { type: "clear-tasks" } }, "*");
};
