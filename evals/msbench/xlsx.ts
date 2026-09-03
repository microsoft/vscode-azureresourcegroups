/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Write a multi-sheet .xlsx with no third-party dependency.
 *
 * ## Why not exceljs
 *
 * `evals/package.json` declares four dependencies, and the comment on `.npmrc`
 * and the header of `importScanner.ts` both record the same rule from different
 * angles: this tree runs on hosts that may have no `node_modules` at all, and
 * every dependency added here is one more thing that can fail on a machine
 * nobody tested. A spreadsheet writer is not worth relaxing that for.
 *
 * An .xlsx is a ZIP of XML. The subset needed for "tabular data with a bold
 * header row" is small enough to write out, and it has the property that matters
 * for a report going to a security team: nothing between the run data and the
 * file can silently reinterpret a value.
 *
 * ## The subset implemented
 *
 * Inline strings (`t="inlineStr"`) rather than a shared-string table — the table
 * is a size optimisation, and correctness is worth more here than bytes. One
 * style (bold) for the header row, `autoFilter` and a frozen header on every
 * sheet, because the first thing anyone does with a results table is sort it.
 *
 * Everything is a string. No number or date typing, deliberately: a verdict like
 * `2026082915324101` is a run id, not a quantity, and Excel's own coercion of
 * long digit strings to floats is a well-known way to corrupt exactly this kind
 * of identifier.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { deflateRawSync } from 'node:zlib';

export interface Sheet {
    readonly name: string;
    /** Row 0 is the header. Rows may be shorter; missing trailing cells render blank. */
    readonly rows: readonly string[][];
    /** Per-column widths in Excel character units. Missing entries fall back to 18. */
    readonly widths?: readonly number[];
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * XML text escaping, plus removal of characters XML 1.0 cannot represent.
 *
 * The second half is not theoretical here: grader stdout is captured verbatim
 * and can carry control bytes from a terminal-formatted stack trace. A raw
 * 0x1b in a cell produces a file Excel refuses to open with no useful message,
 * which would be discovered by the person the report was written for.
 */
function xml(value: string): string {
    let out = '';
    for (const ch of value) {
        const code = ch.codePointAt(0)!;
        const legal = code === 0x09 || code === 0x0a || code === 0x0d
            || (code >= 0x20 && code <= 0xd7ff)
            || (code >= 0xe000 && code <= 0xfffd)
            || code >= 0x10000;
        if (!legal) {
            continue;
        }
        switch (ch) {
            case '&': out += '&amp;'; break;
            case '<': out += '&lt;'; break;
            case '>': out += '&gt;'; break;
            case '"': out += '&quot;'; break;
            case "'": out += '&apos;'; break;
            default: out += ch;
        }
    }
    return out;
}

/** A1, B1, ... Z1, AA1 — column index is 0-based. */
function cellRef(col: number, row: number): string {
    let name = '';
    for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return `${name}${row + 1}`;
}

function sheetXml(sheet: Sheet): string {
    const header = sheet.rows[0] ?? [];
    const columnCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);

    const cols = Array.from({ length: columnCount }, (_, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${sheet.widths?.[i] ?? 18}" customWidth="1"/>`).join('');

    const rows = sheet.rows.map((row, r) => {
        const cells = row.map((value, c) => {
            // s="1" is the bold style defined in stylesXml(); only the header uses it.
            const style = r === 0 ? ' s="1"' : '';
            return `<c r="${cellRef(c, r)}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
        }).join('');
        return `<row r="${r + 1}">${cells}</row>`;
    }).join('');

    const lastCell = cellRef(Math.max(columnCount - 1, 0), Math.max(sheet.rows.length - 1, 0));
    const filter = header.length > 0 && sheet.rows.length > 1
        ? `<autoFilter ref="A1:${lastCell}"/>`
        : '';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<dimension ref="A1:${lastCell}"/>`
        + '<sheetViews><sheetView workbookViewId="0">'
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        + '</sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + (cols ? `<cols>${cols}</cols>` : '')
        + `<sheetData>${rows}</sheetData>`
        + filter
        + '</worksheet>';
}

function stylesXml(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="2">'
        + '<font><sz val="11"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        + '</fonts>'
        + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        + '<borders count="1"><border/></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="2">'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1">'
        + '<alignment vertical="top" wrapText="1"/></xf>'
        + '</cellXfs>'
        + '</styleSheet>';
}

interface Entry {
    readonly path: string;
    readonly data: Buffer;
}

/** Build the ZIP container. Deflate for every entry; no zip64, no data descriptors. */
function zip(entries: readonly Entry[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = Buffer.from(entry.path, 'utf8');
        const compressed = deflateRawSync(entry.data);
        const crc = crc32(entry.data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(8, 8); // deflate
        local.writeUInt16LE(0, 10); // mod time
        local.writeUInt16LE(0x21, 12); // mod date — 1980-01-01, fixed for reproducible output
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);

        offset += local.length + name.length + compressed.length;
    }

    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, centralBuf, end]);
}

/** Serialize sheets into .xlsx bytes. Sheet names are used verbatim; keep them <= 31 chars. */
export function buildXlsx(sheets: readonly Sheet[]): Buffer {
    if (sheets.length === 0) {
        throw new Error('buildXlsx: at least one sheet is required');
    }
    for (const sheet of sheets) {
        if (sheet.name.length > 31) {
            throw new Error(`buildXlsx: sheet name "${sheet.name}" exceeds Excel's 31-character limit`);
        }
    }

    const sheetPaths = sheets.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`);

    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + sheetPaths.map(p => `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '</Types>';

    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>';

    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets>'
        + sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>';

    const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>';

    const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');

    return zip([
        { path: '[Content_Types].xml', data: utf8(contentTypes) },
        { path: '_rels/.rels', data: utf8(rootRels) },
        { path: 'xl/workbook.xml', data: utf8(workbook) },
        { path: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
        { path: 'xl/styles.xml', data: utf8(stylesXml()) },
        ...sheets.map((sheet, i) => ({ path: sheetPaths[i], data: utf8(sheetXml(sheet)) })),
    ]);
}
