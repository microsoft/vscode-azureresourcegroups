import assert = require("assert");
import { IActionContext, wrapFunctionsInTelemetry, wrapFunctionsInTelemetrySync } from "../extension.bundle";

suite('wrapFunctionsInTelemetry', () => {
    test('wrapped sync function returns a Promise', () => {
        const functions = {
            funcThatThrows: () => {
                throw new Error();
            }
        };
        const wrappedFunctions = wrapFunctionsInTelemetry(functions);
        assert.ok(wrappedFunctions.funcThatThrows() instanceof Promise);
    });

    test('Wrapper function throws when the wrapped function throws', async () => {
        const functions = {
            asyncFuncThatThrows: async () => {
                throw new Error();
            }
        };
        const wrappedFunctions = wrapFunctionsInTelemetry(functions);
        assertThrowsAsync(() => wrappedFunctions.asyncFuncThatThrows());
    });

    test('Telemetry result is "Failed" when function throws', async () => {
        const functions = {
            asyncFuncThatThrows: async () => {
                throw new Error();
            }
        };

        let wrapperContext: IActionContext | undefined;
        const wrappedFunctions = wrapFunctionsInTelemetry(functions, {
            beforeHook: (context) => {
                wrapperContext = context;
            },
        });

        try {
            await wrappedFunctions.asyncFuncThatThrows();
        } catch (e) {
            // ignore error
        }

        assert.strictEqual(wrapperContext?.telemetry.properties.result, 'Failed', 'Expected result to be "Failed"');
    });
});

suite('wrapFunctionsInTelemetrySync', () => {
    test('Wrapper function throws when the wrapped function throws', () => {
        const functions = {
            funcThatThrows: () => {
                throw new Error();
            }
        };
        const wrappedFunctions = wrapFunctionsInTelemetrySync(functions);

        assert.throws(() => wrappedFunctions.funcThatThrows());
    });

    test('Telemetry result is "Failed" when function throws', () => {
        const functions = {
            funcThatThrows: () => {
                throw new Error();
            }
        };

        let wrapperContext: IActionContext | undefined;
        const wrappedFunctions = wrapFunctionsInTelemetrySync(functions, {
            beforeHook: (context) => {
                wrapperContext = context;
            },
        });

        try {
            wrappedFunctions.funcThatThrows();
        } catch (e) {
            // ignore error
        }

        assert.strictEqual(wrapperContext?.telemetry.properties.result, 'Failed', 'Expected result to be "Failed"');
    });
});

export async function assertThrowsAsync<T>(block: () => Promise<T>): Promise<void> {
    let blockSync = (): void => { /* ignore */ };
    try {
        await block();
    } catch (e) {
        blockSync = (): void => { throw e; };
    } finally {
        assert.throws(blockSync);
    }
}
