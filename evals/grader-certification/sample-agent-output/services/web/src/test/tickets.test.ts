import { describe, expect, it } from 'vitest';
import { tickets } from '../mocks/data';

// Tests read fixtures directly on purpose: they are not part of the bundle the
// integrate agent repoints, so they do not break the one-file seam swap.
describe('mock tickets', () => {
    it('provides rows for the preview', () => {
        expect(tickets.length).toBeGreaterThan(0);
    });
});
