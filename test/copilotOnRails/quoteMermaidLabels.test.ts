/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { quoteMermaidLabels } from '../../src/webviews/copilotOnRails/views/utils/quoteMermaidLabels';

suite('quoteMermaidLabels', () => {
    suite('quotes unquoted labels', () => {
        test('quotes an edge label that starts with @', () => {
            // The real failure: mermaid v11 lexes a leading `@` as the start of an edge id
            // (`e1@-->`), so the unquoted form fails to parse and the diagram is replaced
            // by mermaid's syntax-error graphic.
            assert.strictEqual(
                quoteMermaidLabels('graph LR\n    API -->|@azure/storage-blob| AZ[(Azurite)]'),
                'graph LR\n    API -->|"@azure/storage-blob"| AZ[("Azurite")]',
            );
        });

        test('quotes rectangle labels', () => {
            assert.strictEqual(
                quoteMermaidLabels('graph LR\n    Web[Web UI<br/>Vite :5173] --> API[API<br/>:3000]'),
                'graph LR\n    Web["Web UI<br/>Vite :5173"] --> API["API<br/>:3000"]',
            );
        });

        test('quotes cylinder, circle and rhombus labels without losing the shape', () => {
            assert.strictEqual(
                quoteMermaidLabels('graph TD\n    S((Start)) --> Q{Ready?}\n    Q --> DB[(Postgres :5432)]'),
                'graph TD\n    S(("Start")) --> Q{"Ready?"}\n    Q --> DB[("Postgres :5432")]',
            );
        });

        test('quotes stadium, subroutine and hexagon labels without losing the shape', () => {
            assert.strictEqual(
                quoteMermaidLabels('graph LR\n    A([Stadium]) --> B[[Subroutine]] --> C{{Hexagon}}'),
                'graph LR\n    A(["Stadium"]) --> B[["Subroutine"]] --> C{{"Hexagon"}}',
            );
        });

        test('quotes a round label that starts with @', () => {
            // `(text)` is one of the most common flowchart shapes, and a leading `@` breaks
            // it for the same reason it breaks an edge label.
            assert.strictEqual(
                quoteMermaidLabels('graph LR\n  A(@azure/identity) --> B\n'),
                'graph LR\n  A("@azure/identity") --> B\n',
            );
        });

        test('quotes a benign round label without corrupting it', () => {
            assert.strictEqual(
                quoteMermaidLabels('graph LR\n  A(Storefront Web) --> B(Commerce API)\n'),
                'graph LR\n  A("Storefront Web") --> B("Commerce API")\n',
            );
        });

        test('quotes a subgraph title', () => {
            assert.strictEqual(
                quoteMermaidLabels('graph TB\n    subgraph core [Core Services]\n        A[API] --> B[DB]\n    end'),
                'graph TB\n    subgraph core ["Core Services"]\n        A["API"] --> B["DB"]\n    end',
            );
        });

        test('accepts flowchart as well as graph', () => {
            assert.strictEqual(
                quoteMermaidLabels('flowchart LR\n    A[API] --> B[DB]'),
                'flowchart LR\n    A["API"] --> B["DB"]',
            );
        });

        test('normalizes a diagram behind a directive or frontmatter, leaving the preamble alone', () => {
            assert.strictEqual(
                quoteMermaidLabels('%%{init: {"theme":"dark"}}%%\ngraph LR\n    A[API] --> B[DB]'),
                '%%{init: {"theme":"dark"}}%%\ngraph LR\n    A["API"] --> B["DB"]',
            );
            assert.strictEqual(
                quoteMermaidLabels('---\nconfig:\n  theme: dark\n---\ngraph LR\n    A[API] --> B[DB]'),
                '---\nconfig:\n  theme: dark\n---\ngraph LR\n    A["API"] --> B["DB"]',
            );
        });
    });

    suite('leaves valid syntax alone', () => {
        test('is a no-op on an already-quoted diagram', () => {
            const code = 'graph LR\n    A["Web App"] -->|"HTTP"| B["API"]';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });

        test('is idempotent', () => {
            const once = quoteMermaidLabels('graph LR\n    A[API] -->|calls| B[(DB)]');
            assert.strictEqual(quoteMermaidLabels(once), once);
        });

        test('is idempotent on a round-shape diagram', () => {
            const once = quoteMermaidLabels('graph LR\n  A(@azure/identity) --> B(Commerce API)\n');
            assert.strictEqual(quoteMermaidLabels(once), once);
        });

        test('does not re-quote a stadium label as a round one', () => {
            // The `[text]` rule turns `A([Start])` into `A(["Start"])` before the round
            // rule runs, so the round rule has to leave a paren body that starts with `[`
            // alone — otherwise the stadium collapses into `A("[\"Start\"]")`.
            assert.strictEqual(
                quoteMermaidLabels('graph LR\n  A([Start]) --> B\n'),
                'graph LR\n  A(["Start"]) --> B\n',
            );
        });

        test('does not touch brackets, braces or pipes inside an already-quoted label', () => {
            const code = 'graph LR\n    A["Blob (hot tier) [preview]"] --> B["Queue {std}"]';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });

        test('does not touch markdown string labels', () => {
            const code = 'graph LR\n    A["`**bold** label`"] --> B["`_italic_`"]';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });

        test('does not rewrite v11 node or edge metadata blocks', () => {
            // `id@{ shape: rect }` and `e1@{ animate: true }` are brace-delimited
            // configuration, not labels — quoting their bodies would change what they mean.
            const code = 'flowchart LR\n    A@{ shape: rect, label: "Hi" }\n    A e1@--> B\n    e1@{ animate: true }';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });

        test('does not touch comment lines', () => {
            const code = 'graph LR\n    %% A[Not a node] and |not an edge|\n    A[API] --> B[DB]';
            assert.strictEqual(
                quoteMermaidLabels(code),
                'graph LR\n    %% A[Not a node] and |not an edge|\n    A["API"] --> B["DB"]',
            );
        });

        test('does not touch styling or interaction directives', () => {
            const code =
                'graph LR\n' +
                '    classDef svc fill:#f9f,stroke:#333\n' +
                '    style A fill:#bbf\n' +
                '    linkStyle 0 stroke:#f00\n' +
                '    click A "https://example.com" "Open docs"';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });

        test('does not flatten parallelogram or trapezoid shapes into rectangles', () => {
            const code = 'graph LR\n    A[/Input/] --> B[\\Output\\] --> C[/Trapezoid\\]';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });

        test('leaves a diagram with no labels untouched', () => {
            const code = 'graph LR\n    A --> B --> C';
            assert.strictEqual(quoteMermaidLabels(code), code);
        });
    });

    suite('non-flowchart diagrams', () => {
        // `[]`, `{}` and `|` mean something else entirely outside a flowchart, so these
        // must come back byte-for-byte identical.
        const diagrams: Record<string, string> = {
            sequence: 'sequenceDiagram\n    Alice->>John: Hello John\n    John-->>Alice: Great!',
            class: 'classDiagram\n    class Animal { +int age }\n    Animal <|-- Dog',
            er: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places',
            state: 'stateDiagram-v2\n    [*] --> Still\n    Still --> [*]',
            pie: 'pie title Pets\n    "Dogs" : 386\n    "Cats" : 85',
        };

        for (const [name, code] of Object.entries(diagrams)) {
            test(`leaves the ${name} diagram untouched`, () => {
                assert.strictEqual(quoteMermaidLabels(code), code);
            });
        }

        test('leaves an empty diagram untouched', () => {
            assert.strictEqual(quoteMermaidLabels(''), '');
        });
    });
});
