/**
 * Interface describing an object that wraps another object.
 *
 * The host extension will wrap all tree nodes provided by the client
 * extensions. When commands are executed, the wrapper objects are
 * sent directly to the client extension, which will need to unwrap
 * them. The `registerCommandWithTreeNodeUnwrapping` method below, used
 * in place of `registerCommand`, will intelligently do this
 * unwrapping automatically (i.e., will not unwrap if the arguments
 * aren't wrappers)
 */
export declare interface Wrapper {
    unwrap<T>(): T;
}

export function isWrapper(maybeWrapper: unknown): maybeWrapper is Wrapper {
    if (maybeWrapper && typeof maybeWrapper === 'object' &&
        (maybeWrapper as Wrapper).unwrap && typeof (maybeWrapper as Wrapper).unwrap === 'function') {
        return true;
    }

    return false;
}

export function unwrapArgs<T>(args?: unknown[]): [node?: T, nodes?: T[], ...args: unknown[]] {
    const maybeNodeWrapper = args?.[0];
    const maybeNodeWrapperArray = args?.[1];
    const remainingArgs = args?.slice(2) ?? [];

    let node: T | undefined;
    if (maybeNodeWrapper && isWrapper(maybeNodeWrapper)) {
        // If the first arg is a wrapper, unwrap it
        node = maybeNodeWrapper.unwrap<T>();
    } else if (maybeNodeWrapper) {
        // Otherwise, assume it is just a T
        node = maybeNodeWrapper as T;
    }

    let nodes: T[] | undefined;
    if (maybeNodeWrapperArray && Array.isArray(maybeNodeWrapperArray) && maybeNodeWrapperArray.every(n => isWrapper(n))) {
        // If the first arg is an array of wrappers, unwrap them
        const wrappedNodes = maybeNodeWrapperArray as Wrapper[];
        nodes = [];
        for (const n of wrappedNodes) {
            nodes.push(n.unwrap<T>())
        }
    } else if (maybeNodeWrapperArray && Array.isArray(maybeNodeWrapperArray)) {
        // Otherwise, assume it is just an array of T's
        nodes = maybeNodeWrapperArray as T[];
    }

    return [node, nodes, ...remainingArgs];
}
