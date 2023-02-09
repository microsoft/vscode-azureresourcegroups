import { apiUtils } from "../../extension.bundle";
import assert = require("assert");

suite('v1 API tests', async () => {
    test('v1 API should be defined', async () => {
        const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>('ms-azuretools.vscode-azureresourcegroups');

        assert.ok(apiProvider, 'API provider is undefined');

        const v1Api = apiProvider.getApi('0.0.1', {
            extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests',
        });

        assert.ok(v1Api);
    });
});
