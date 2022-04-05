import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";
import { ActivityBase } from "./Activity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const activities: ActivityBase<any>[] = [];

export async function registerActivity<R>(activity: ActivityBase<R>): Promise<R | undefined> {
    return await callWithTelemetryAndErrorHandling('registerActivity', async (context: IActionContext) => {
        activities.push(activity);
        // make activity show up
        void ext.activityLogTree.refresh(context);
        const result: R | undefined = await activity.run();
        void ext.activityLogTree.refresh(context);
        return result;
    });
}
