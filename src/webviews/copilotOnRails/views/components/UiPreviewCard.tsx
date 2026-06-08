/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Avatar,
    Badge,
    Body1,
    Button,
    Caption1,
    Card,
    CardFooter,
    CardHeader,
    CardPreview,
    Divider,
    Field,
    FluentProvider,
    Input,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Subtitle1,
    Subtitle2,
    Tab,
    TabList,
    Textarea,
    Title3,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
} from '@fluentui/react-components';
import {
    AppsRegular,
    BookmarkRegular,
    CalendarRegular,
    ChevronDownRegular,
    DocumentRegular,
    GridRegular,
    HomeRegular,
    MailRegular,
    PersonRegular,
    SearchRegular,
    SettingsRegular,
    TableSimpleRegular,
} from '@fluentui/react-icons';
import { useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { type PageEntry, type PaletteEntry, type PlanSection, splitLayoutRegions } from '../utils/parseScaffoldPlanMarkdown';
import { buildPreviewTheme } from '../utils/buildPreviewTheme';

interface UiPreviewCardProps {
    section: PlanSection;
    uiNote: string;
    disabled?: boolean;
    /** Called when the user picks a new color for a palette token. */
    onPaletteChange: (token: string, originalHex: string, newHex: string) => void;
    /** Called when the user edits the typography font family. */
    onTypographyChange: (originalValue: string, newValue: string) => void;
    onUiNoteChange: (text: string) => void;
}

/**
 * Read-only view of Section 5 (Design System & UI), rendered as a stylized
 * wireframe per page. The user can pick new palette colors, edit the font
 * family, and add free-form UI notes — every edit is bubbled up so the parent
 * can mirror it into the feedback drawer.
 */
export const UiPreviewCard = ({ section, uiNote, disabled, onPaletteChange, onTypographyChange, onUiNoteChange }: UiPreviewCardProps): JSX.Element | null => {
    const palette = useMemo(() => extractPalette(section), [section]);
    const pages = useMemo(() => extractPages(section), [section]);
    const componentLibrary = useMemo(() => extractKeyValue(section, 'Component Library'), [section]);
    const typography = useMemo(() => extractKeyValue(section, 'Typography'), [section]);
    const styleDirection = useMemo(() => extractKeyValue(section, 'Style Direction'), [section]);
    const previewTheme = useMemo(() => buildPreviewTheme(palette), [palette]);

    const [activePageIdx, setActivePageIdx] = useState(0);
    const colorInputs = useRef<Map<string, HTMLInputElement | null>>(new Map());
    const originalTypography = useRef<string | undefined>(undefined);
    const originalPaletteHex = useRef<Map<string, string>>(new Map());

    if (palette.length === 0 || pages.length === 0) {
        return null;
    }

    const activePage = pages[Math.min(activePageIdx, pages.length - 1)];
    const previewStyle = buildPreviewCssVars(palette, typography);
    const fluentRendered = componentLibrary?.toLowerCase().includes('fluent') ?? false;

    const handleSwatchClick = (token: string): void => {
        const input = colorInputs.current.get(token);
        input?.click();
    };

    const handleColorChange = (entry: PaletteEntry, newHex: string): void => {
        if (!originalPaletteHex.current.has(entry.token)) {
            originalPaletteHex.current.set(entry.token, entry.hex);
        }
        const original = originalPaletteHex.current.get(entry.token) ?? entry.hex;
        onPaletteChange(entry.token, original, newHex);
    };

    const handleTypographyChange = (next: string): void => {
        if (originalTypography.current === undefined) {
            originalTypography.current = typography ?? '';
        }
        onTypographyChange(originalTypography.current, next);
    };

    return (
        <div className='sectionCard uiPreviewCard'>
            <div className='uiPreviewCard__header'>
                <h2>UI Preview</h2>
                {componentLibrary && (
                    <Badge appearance='tint' color='brand' size='medium'>{componentLibrary}</Badge>
                )}
            </div>
            {styleDirection && <p className='uiPreviewCard__styleDirection'>{styleDirection}</p>}

            {pages.length > 1 && (
                <div className='uiPreviewCard__tabs' role='tablist' aria-label='Preview page'>
                    {pages.map((p, i) => (
                        <button
                            key={`${p.page}-${i}`}
                            role='tab'
                            aria-selected={i === activePageIdx}
                            className={`uiPreviewCard__tab ${i === activePageIdx ? 'uiPreviewCard__tab--active' : ''}`}
                            onClick={() => setActivePageIdx(i)}
                        >
                            {p.page}
                        </button>
                    ))}
                </div>
            )}

            {!fluentRendered && componentLibrary && (
                <p className='uiPreviewCard__previewNote'>
                    Preview rendered with Fluent UI v9 — your scaffolded app will use <strong>{componentLibrary}</strong> with equivalent components.
                </p>
            )}

            <div className='uiPreviewCard__frame' style={previewStyle}>
                <div className='uiPreviewCard__chrome'>
                    <span className='uiPreviewCard__chromeDot' />
                    <span className='uiPreviewCard__chromeDot' />
                    <span className='uiPreviewCard__chromeDot' />
                    <span className='uiPreviewCard__urlPill'>{activePage.route || `/${activePage.page.toLowerCase().replace(/\s+/g, '-')}`}</span>
                </div>
                <FluentProvider theme={previewTheme} className='uiPreviewCard__viewport'>
                    {activePage.regions.map((region, i) => (
                        <RegionBlock key={`${region}-${i}`} token={region} pageTitle={activePage.page} purpose={activePage.purpose} />
                    ))}
                </FluentProvider>
            </div>

            <div className='uiPreviewCard__paletteRow'>
                {palette.map((entry) => (
                    <div key={entry.token} className='uiPreviewCard__swatch'>
                        <button
                            type='button'
                            className='uiPreviewCard__swatchChip'
                            style={{ background: entry.hex }}
                            disabled={disabled}
                            aria-label={`Change ${entry.token} color`}
                            onClick={() => handleSwatchClick(entry.token)}
                        />
                        <input
                            ref={(el) => { colorInputs.current.set(entry.token, el); }}
                            type='color'
                            value={normalizeHexForInput(entry.hex)}
                            disabled={disabled}
                            onChange={(e) => handleColorChange(entry, e.target.value)}
                            className='uiPreviewCard__swatchInput'
                            aria-hidden='true'
                            tabIndex={-1}
                        />
                        <div className='uiPreviewCard__swatchMeta'>
                            <span className='uiPreviewCard__swatchToken'>{entry.token}</span>
                            <span className='uiPreviewCard__swatchHex'>{entry.hex.toUpperCase()}</span>
                        </div>
                    </div>
                ))}
            </div>

            {typography !== undefined && (
                <div className='uiPreviewCard__typographyRow'>
                    <label className='uiPreviewCard__typographyLabel' htmlFor='ui-preview-typography'>
                        Typography
                    </label>
                    <Input
                        id='ui-preview-typography'
                        className='uiPreviewCard__typographyInput'
                        value={typography}
                        disabled={disabled}
                        onChange={(_, data) => handleTypographyChange(data.value)}
                    />
                </div>
            )}

            <div className='uiPreviewCard__noteRow'>
                <label className='uiPreviewCard__noteLabel' htmlFor='ui-preview-note'>
                    Request UI changes
                </label>
                <Textarea
                    id='ui-preview-note'
                    className='uiPreviewCard__noteInput'
                    value={uiNote}
                    disabled={disabled}
                    placeholder="e.g. 'Use larger headlines on the dashboard' or 'Add a search bar to the header'"
                    rows={2}
                    resize='vertical'
                    onChange={(_, data) => onUiNoteChange(data.value)}
                />
            </div>
        </div>
    );
};

interface RegionBlockProps {
    token: string;
    pageTitle: string;
    purpose: string;
}

/**
 * Render a single layout region using real Fluent UI v9 primitives. Compound
 * tokens like `split(a|b)` and `two-column(a+b)` recurse into their children
 * so the wireframe shows nested structure.
 *
 * Each region token is treated as layout *intent*, not a literal `<div>`:
 * `header` becomes a `Toolbar`, `hero` becomes a filled `Card`, `grid`/`list`
 * become arrays of `Card`s, `form` becomes `Field`+`Input`s with one
 * `validationState='warning'` example, etc. See
 * `.agents/skills/azure-project-scaffold/references/frontend-quality-bar.md`
 * for the full per-library mapping the scaffold agent follows.
 */
const RegionBlock = ({ token, pageTitle, purpose }: RegionBlockProps): JSX.Element => {
    const compound = parseCompound(token);
    if (compound) {
        const { kind, children } = compound;
        const className = kind === 'split' ? 'uiPreviewCard__split' : 'uiPreviewCard__twoColumn';
        return (
            <div className={className}>
                {children.map((child, i) => (
                    <div className='uiPreviewCard__splitChild' key={`${child}-${i}`}>
                        <RegionBlock token={child} pageTitle={pageTitle} purpose={purpose} />
                    </div>
                ))}
            </div>
        );
    }

    const base = token.toLowerCase();
    const brand = pageTitle.split(/\s+/)[0] || 'App';
    switch (base) {
        case 'header':
            return (
                <Toolbar aria-label='App header' size='medium' className='uiPreviewCard__regionWrap'>
                    <Subtitle1>{brand}</Subtitle1>
                    <ToolbarDivider />
                    <ToolbarButton icon={<HomeRegular />}>Home</ToolbarButton>
                    <ToolbarButton icon={<GridRegular />}>Browse</ToolbarButton>
                    <ToolbarButton icon={<DocumentRegular />}>Docs</ToolbarButton>
                    <div style={{ flex: 1 }} />
                    <ToolbarButton icon={<SearchRegular />} aria-label='Search' />
                    <ToolbarButton icon={<SettingsRegular />} aria-label='Settings' />
                    <Avatar name='You' size={28} color='brand' />
                </Toolbar>
            );
        case 'nav':
            return (
                <div className='uiPreviewCard__regionWrap'>
                    <TabList selectedValue='home' size='small'>
                        <Tab value='home' icon={<HomeRegular />}>Home</Tab>
                        <Tab value='browse' icon={<GridRegular />}>Browse</Tab>
                        <Tab value='library' icon={<BookmarkRegular />}>Library</Tab>
                        <Tab value='settings' icon={<SettingsRegular />}>Settings</Tab>
                    </TabList>
                </div>
            );
        case 'sidebar':
            return (
                <div className='uiPreviewCard__regionWrap uiPreviewCard__sidebar'>
                    <TabList selectedValue='overview' vertical size='small'>
                        <Tab value='overview' icon={<AppsRegular />}>Overview</Tab>
                        <Tab value='recent' icon={<CalendarRegular />}>Recent</Tab>
                        <Tab value='saved' icon={<BookmarkRegular />}>Saved</Tab>
                        <Tab value='inbox' icon={<MailRegular />}>Inbox</Tab>
                        <Tab value='settings' icon={<SettingsRegular />}>Settings</Tab>
                    </TabList>
                </div>
            );
        case 'hero':
            return (
                <Card appearance='filled-alternative' className='uiPreviewCard__regionWrap uiPreviewCard__hero'>
                    <CardHeader
                        header={<Title3>{pageTitle}</Title3>}
                        description={purpose ? <Body1>{purpose}</Body1> : undefined}
                    />
                    <CardFooter>
                        <Button appearance='primary' icon={<ChevronDownRegular />} iconPosition='after'>Get started</Button>
                        <Button appearance='subtle'>Learn more</Button>
                    </CardFooter>
                </Card>
            );
        case 'main':
            return (
                <div className='uiPreviewCard__regionWrap uiPreviewCard__main'>
                    <Subtitle2>{pageTitle}</Subtitle2>
                    <Body1>{purpose || 'Primary content area.'}</Body1>
                </div>
            );
        case 'list':
        case 'card-list':
        case 'grid': {
            const itemCount = base === 'grid' ? 6 : 4;
            const labels = ['Recent items', 'Discover', 'Trending', 'Recommended', 'Updates', 'Favorites'];
            const wrapperClass = base === 'grid'
                ? 'uiPreviewCard__regionWrap uiPreviewCard__cardGrid'
                : 'uiPreviewCard__regionWrap uiPreviewCard__cardList';
            return (
                <div className={wrapperClass}>
                    {Array.from({ length: itemCount }).map((_, i) => (
                        <Card key={i} appearance='outline' size='small'>
                            {base === 'grid' && (
                                <CardPreview className='uiPreviewCard__cardPreview' />
                            )}
                            <CardHeader
                                image={<Avatar name={labels[i % labels.length]} size={32} color='colorful' />}
                                header={<Subtitle2>{labels[i % labels.length]}</Subtitle2>}
                                description={<Caption1>Item {i + 1}</Caption1>}
                            />
                        </Card>
                    ))}
                </div>
            );
        }
        case 'form':
            return (
                <div className='uiPreviewCard__regionWrap uiPreviewCard__form'>
                    <Field label='Name' required>
                        <Input placeholder='Ada Lovelace' />
                    </Field>
                    <Field label='Email' required validationState='warning' validationMessage='Use your work email'>
                        <Input type='email' placeholder='ada@example.com' />
                    </Field>
                    <Field label='Notes'>
                        <Textarea rows={3} resize='vertical' />
                    </Field>
                    <div className='uiPreviewCard__formActions'>
                        <Button appearance='secondary'>Cancel</Button>
                        <Button appearance='primary'>Continue</Button>
                    </div>
                </div>
            );
        case 'table':
            return (
                <Card appearance='outline' className='uiPreviewCard__regionWrap uiPreviewCard__tableCard'>
                    <Toolbar size='small' aria-label='Table actions'>
                        <ToolbarButton icon={<TableSimpleRegular />}>All items</ToolbarButton>
                        <ToolbarDivider />
                        <ToolbarButton icon={<SearchRegular />} aria-label='Search' />
                        <div style={{ flex: 1 }} />
                        <ToolbarButton icon={<DocumentRegular />} appearance='primary'>New</ToolbarButton>
                    </Toolbar>
                    <Divider />
                    <div className='uiPreviewCard__tableHead'>
                        <span>Name</span><span>Status</span><span>Updated</span>
                    </div>
                    {['Project Atlas', 'Beta Launch', 'Quarterly Review'].map((label, i) => (
                        <div key={i} className='uiPreviewCard__tableRow'>
                            <span>{label}</span>
                            <span><Badge appearance='tint' color={i === 1 ? 'warning' : 'success'} size='small'>{i === 1 ? 'Pending' : 'Active'}</Badge></span>
                            <Caption1>2d ago</Caption1>
                        </div>
                    ))}
                </Card>
            );
        case 'actions':
        case 'action-bar':
            return (
                <Toolbar aria-label='Page actions' size='small' className='uiPreviewCard__regionWrap uiPreviewCard__actionBar'>
                    <div style={{ flex: 1 }} />
                    <ToolbarButton>Cancel</ToolbarButton>
                    <ToolbarButton appearance='primary'>Save</ToolbarButton>
                </Toolbar>
            );
        case 'tabs':
            return (
                <div className='uiPreviewCard__regionWrap'>
                    <TabList selectedValue='overview' size='medium'>
                        <Tab value='overview'>Overview</Tab>
                        <Tab value='details'>Details</Tab>
                        <Tab value='activity'>Activity</Tab>
                    </TabList>
                </div>
            );
        case 'modal':
            return (
                <Card appearance='filled' className='uiPreviewCard__regionWrap uiPreviewCard__modal'>
                    <CardHeader
                        image={<Avatar icon={<PersonRegular />} size={32} color='brand' />}
                        header={<Subtitle1>Confirm action</Subtitle1>}
                        description={<Body1>Review the details before continuing.</Body1>}
                    />
                    <CardFooter>
                        <Button appearance='subtle'>Cancel</Button>
                        <Button appearance='primary'>Confirm</Button>
                    </CardFooter>
                </Card>
            );
        case 'footer':
            return (
                <div className='uiPreviewCard__regionWrap uiPreviewCard__footer'>
                    <Divider />
                    <div className='uiPreviewCard__footerRow'>
                        <Caption1>&copy; {brand}</Caption1>
                        <Caption1>Privacy &middot; Terms</Caption1>
                    </div>
                </div>
            );
        default:
            return (
                <MessageBar intent='info' className='uiPreviewCard__regionWrap'>
                    <MessageBarBody>
                        <MessageBarTitle>{token}</MessageBarTitle>
                        Custom region — render with the library primitive that best matches this intent.
                    </MessageBarBody>
                </MessageBar>
            );
    }
};

function extractPalette(section: PlanSection): PaletteEntry[] {
    for (const item of section.content) {
        if (item.type === 'colorPalette') {
            return item.entries;
        }
    }
    return [];
}

function extractPages(section: PlanSection): PageEntry[] {
    for (const item of section.content) {
        if (item.type === 'pages') {
            return item.entries;
        }
    }
    return [];
}

function extractKeyValue(section: PlanSection, key: string): string | undefined {
    for (const item of section.content) {
        if (item.type === 'keyValue' && item.key === key) {
            return item.value;
        }
    }
    return undefined;
}

const TOKEN_ROLE_RULES: ReadonlyArray<{ role: string; matchers: RegExp[] }> = [
    { role: 'primary', matchers: [/primary/i, /brand/i] },
    { role: 'accent', matchers: [/accent/i, /secondary/i] },
    { role: 'surface', matchers: [/surface/i, /background/i, /bg\b/i, /\bcanvas\b/i] },
    { role: 'text', matchers: [/text/i, /foreground/i, /\bfg\b/i, /heading/i] },
    { role: 'muted', matchers: [/muted/i, /subtle/i, /tertiary/i] },
    { role: 'border', matchers: [/border/i, /divider/i, /stroke/i] },
];

function buildPreviewCssVars(palette: PaletteEntry[], typography: string | undefined): CSSProperties {
    const roleHex: Record<string, string> = {};
    for (const entry of palette) {
        for (const rule of TOKEN_ROLE_RULES) {
            if (rule.role in roleHex) {
                continue;
            }
            if (rule.matchers.some(r => r.test(entry.token))) {
                roleHex[rule.role] = entry.hex;
                break;
            }
        }
    }
    // Sensible fallbacks: pick from any remaining palette entries in order.
    const remaining = palette.filter(p => !Object.values(roleHex).includes(p.hex));
    const fallback = (role: string, idx: number): string => roleHex[role] ?? remaining[idx]?.hex ?? palette[Math.min(idx, palette.length - 1)]?.hex ?? '#666666';

    const surface = fallback('surface', 0);
    const text = fallback('text', 1);
    const primary = fallback('primary', 2);
    const accent = fallback('accent', 3);
    const muted = fallback('muted', 4);
    const border = fallback('border', 5);

    const fontStack = typography && typography.trim().length > 0
        ? `${typography}, system-ui, -apple-system, "Segoe UI", sans-serif`
        : 'system-ui, -apple-system, "Segoe UI", sans-serif';

    const vars: Record<string, string> = {
        '--preview-surface': surface,
        '--preview-text': text,
        '--preview-primary': primary,
        '--preview-on-primary': pickReadableForeground(primary),
        '--preview-accent': accent,
        '--preview-on-accent': pickReadableForeground(accent),
        '--preview-muted': muted,
        '--preview-border': border,
        '--preview-font': fontStack,
    };
    return vars as CSSProperties;
}

/** Return black or white depending on which has better contrast with `hex`. */
function pickReadableForeground(hex: string): string {
    const normalized = normalizeHexForInput(hex).slice(1);
    if (normalized.length !== 6) {
        return '#ffffff';
    }
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    // Simple relative-luminance approximation; >0.55 → dark text.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

function normalizeHexForInput(hex: string): string {
    const raw = hex.replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) {
        return '#' + raw.split('').map(c => c + c).join('');
    }
    if (/^[0-9a-f]{6}$/.test(raw)) {
        return '#' + raw;
    }
    if (/^[0-9a-f]{8}$/.test(raw)) {
        return '#' + raw.slice(0, 6);
    }
    return '#000000';
}

function parseCompound(token: string): { kind: 'split' | 'two-column'; children: string[] } | undefined {
    const splitMatch = token.match(/^split\s*\((.+)\)\s*$/i);
    if (splitMatch) {
        return { kind: 'split', children: splitMatch[1].split('|').map(s => s.trim()).filter(Boolean) };
    }
    const twoColMatch = token.match(/^two-column\s*\((.+)\)\s*$/i);
    if (twoColMatch) {
        return { kind: 'two-column', children: splitLayoutRegions(twoColMatch[1]) };
    }
    return undefined;
}
