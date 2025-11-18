import { IActionContext } from "@microsoft/vscode-azext-utils";
import { AzExtCredentialManager } from "api/src/auth/credentialManager/AzExtCredentialManager";

export interface VerifyApiSessionInternalContext extends IActionContext {
    credentialManager: AzExtCredentialManager,
    clientExtensionId: string,
    azureResourcesCredential: string,
}
