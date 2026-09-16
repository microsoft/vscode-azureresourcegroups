/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TicketsPage } from './pages/TicketsPage';

export function App(): JSX.Element {
    return (
        <main>
            <h1>Support Tickets</h1>
            <TicketsPage />
        </main>
    );
}
