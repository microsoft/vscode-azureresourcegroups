import { ExecuteActivityContext } from "@microsoft/vscode-azext-utils";
import { registerActivity } from "../activityLog/registerActivity";
import { settingUtils } from "./settingUtils";

export async function createActivityContext(): Promise<ExecuteActivityContext> {
    return {
        registerActivity: async (activity) => registerActivity(activity),
        suppressNotification: await settingUtils.getWorkspaceSetting('suppressActivityNotifications'),
    };
}
