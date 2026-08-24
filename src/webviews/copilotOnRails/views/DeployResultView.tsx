/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from '@fluentui/react-components';
import {
    CheckmarkCircleFilled,
    CopyRegular,
    DismissCircleFilled,
    DocumentRegular,
    ErrorCircleFilled,
    OpenRegular,
    QuestionCircleFilled,
    WarningRegular,
} from '@fluentui/react-icons';
import { useConfiguration, WebviewContext } from '@microsoft/vscode-azext-webview/webview';
import { useCallback, useContext, useEffect, useState, type JSX } from 'react';
import { StageProgress } from './components/StageProgress';
import './styles/deployResultView.scss';
import {
    type DeployResultData,
    type DeployResultEndpoint,
    type DeployResultHealthStatus,
} from './utils/deployResultTypes';
import { type DeployResultViewConfiguration, type DeployResultViewStrings } from './utils/viewConfigTypes';

export type { DeployResultData };

/** Map a health status onto the CSS modifier used to colour its badge. */
const HEALTH_TONE: Record<DeployResultHealthStatus, string> = {
    healthy: 'good',
    degraded: 'warn',
    unreachable: 'bad',
    unknown: 'neutral',
};

function StatusIcon({ status }: { status: DeployResultData['status'] }): JSX.Element {
    switch (status) {
        case 'succeeded':
            return <CheckmarkCircleFilled className='statusIcon good' />;
        case 'failed':
            return <DismissCircleFilled className='statusIcon bad' />;
        case 'in-progress':
            return <ErrorCircleFilled className='statusIcon warn' />;
        default:
            return <QuestionCircleFilled className='statusIcon neutral' />;
    }
}

function statusHeading(status: DeployResultData['status'], strings: DeployResultViewStrings): string {
    switch (status) {
        case 'succeeded':
            return strings.succeededHeading;
        case 'failed':
            return strings.failedHeading;
        case 'in-progress':
            return strings.inProgressHeading;
        default:
            return strings.unknownHeading;
    }
}

function HealthBadge({ status }: { status: DeployResultHealthStatus }): JSX.Element {
    return <span className={`healthBadge ${HEALTH_TONE[status]}`}>{status}</span>;
}

type InfoCardProps = { label: string; value: string; mono?: boolean };

const InfoCard = ({ label, value, mono }: InfoCardProps): JSX.Element => (
    <div className='infoCard'>
        <div className='infoLabel'>{label}</div>
        <div className={`infoValue${mono ? ' mono' : ''}`}>{value}</div>
    </div>
);

type SectionProps = { heading: string; children: React.ReactNode };

const Section = ({ heading, children }: SectionProps): JSX.Element => (
    <section className='sectionCard'>
        <h2>{heading}</h2>
        {children}
    </section>
);

export const DeployResultView = (): JSX.Element => {
    const { strings } = useConfiguration<DeployResultViewConfiguration>();
    const [result, setResult] = useState<DeployResultData | null>(null);
    const [copied, setCopied] = useState(false);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const { vscodeApi } = useContext(WebviewContext);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.data?.command === 'setDeployResultData') {
                setResult(event.data.data as DeployResultData);
                setCopied(false);
                setCopiedKey(null);
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ command: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, [vscodeApi]);

    // Reset the transient "Copied" affordance so the button returns to its
    // default label a couple of seconds after a copy.
    useEffect(() => {
        if (!copied) {
            return;
        }
        const timer = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timer);
    }, [copied]);

    // Same transient reset for the per-resource cleanup copy buttons, keyed by
    // the item that was copied so only that button shows "Copied".
    useEffect(() => {
        if (copiedKey === null) {
            return;
        }
        const timer = window.setTimeout(() => setCopiedKey(null), 2000);
        return () => window.clearTimeout(timer);
    }, [copiedKey]);

    const openExternal = useCallback((url: string) => {
        vscodeApi.postMessage({ command: 'openExternal', url });
    }, [vscodeApi]);

    const copyText = useCallback((text: string) => {
        vscodeApi.postMessage({ command: 'copyText', text });
        setCopied(true);
    }, [vscodeApi]);

    const copyItemText = useCallback((text: string, key: string) => {
        vscodeApi.postMessage({ command: 'copyText', text });
        setCopiedKey(key);
    }, [vscodeApi]);

    if (!result) {
        return <div className='deployResultView'><p>{strings.loading}</p></div>;
    }

    if (result.parseError) {
        return (
            <div className='deployResultView'>
                <div className='parseFailureWarning' role='alert'>
                    <div className='parseFailureIcon'><WarningRegular /></div>
                    <div className='parseFailureBody'>
                        <h2>{strings.parseFailureTitle}</h2>
                        <p>{result.parseError.message || strings.parseFailureFallbackMessage}</p>
                        {result.parseError.fileLabel && (
                            <p className='parseFailureFile'><strong>{strings.parseFailureFileLabel}:</strong> {result.parseError.fileLabel}</p>
                        )}
                        <Button
                            appearance='primary'
                            icon={<DocumentRegular />}
                            onClick={() => vscodeApi.postMessage({ command: 'openSourceFile' })}
                        >
                            {strings.openResultFileButton}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const primary: DeployResultEndpoint | undefined = result.primaryEndpoint;

    return (
        <div className='deployResultView'>
            <StageProgress currentStage={2} />

            <header className='resultHeader'>
                <div className='resultHeaderMain'>
                    <StatusIcon status={result.status} />
                    <h1>{statusHeading(result.status, strings)}</h1>
                </div>
                <div className='resultHeaderActions'>
                    {primary && (
                        <Button appearance='primary' icon={<OpenRegular />} onClick={() => openExternal(primary.url)}>
                            {strings.openAppButton}
                        </Button>
                    )}
                    {result.portalUrl && (
                        <Button icon={<OpenRegular />} onClick={() => openExternal(result.portalUrl)}>
                            {strings.openPortalButton}
                        </Button>
                    )}
                </div>
            </header>

            {result.partial && (
                <div className='banner warn' role='alert'>
                    <WarningRegular />
                    <span>{strings.partialBanner}</span>
                </div>
            )}

            <div className='infoCards'>
                {result.resourceGroupName && <InfoCard label={strings.resourceGroupLabel} value={result.resourceGroupName} mono />}
                {result.region && <InfoCard label={strings.regionLabel} value={result.region} />}
                {result.durationLabel && <InfoCard label={strings.elapsedLabel} value={result.durationLabel} />}
                <div className='infoCard'>
                    <div className='infoLabel'>{strings.healthLabel}</div>
                    <div className='infoValue'><HealthBadge status={result.healthStatus} /></div>
                </div>
            </div>

            {result.warnings.length > 0 && (
                <Section heading={strings.warningsHeading}>
                    <ul className='bulletList warn'>
                        {result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
                    </ul>
                </Section>
            )}

            {result.endpoints.length > 0 && (
                <Section heading={strings.endpointsHeading}>
                    <table className='resultTable endpointsTable'>
                        <thead>
                            <tr>
                                <th>{strings.endpointNameHeader}</th>
                                <th>{strings.endpointUrlHeader}</th>
                                <th>{strings.endpointHealthHeader}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.endpoints.map((endpoint) => (
                                <tr key={endpoint.name}>
                                    <td>{endpoint.label}</td>
                                    <td>
                                        <a
                                            href={endpoint.url}
                                            onClick={(e) => { e.preventDefault(); openExternal(endpoint.url); }}
                                        >
                                            {endpoint.url}
                                        </a>
                                    </td>
                                    <td>
                                        {endpoint.healthStatus
                                            ? <HealthBadge status={endpoint.healthStatus} />
                                            : <span className='muted'>—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Section>
            )}

            {result.resources.length > 0 && (
                <Section heading={strings.resourcesHeading}>
                    <table className='resultTable resourcesTable'>
                        <thead>
                            <tr>
                                <th>{strings.resourceTypeHeader}</th>
                                <th>{strings.resourceNameHeader}</th>
                                {result.resources.some(r => r.status) && <th>{strings.resourceStatusHeader}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {result.resources.map((resource) => (
                                <tr key={`${resource.type}-${resource.name}`}>
                                    <td>{resource.type}</td>
                                    <td className='mono'>{resource.name}</td>
                                    {result.resources.some(r => r.status) && (
                                        <td>
                                            {resource.status ?? '—'}
                                            {resource.error && <div className='cellError'>{resource.error}</div>}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Section>
            )}

            {result.healthDetail && (
                <Section heading={strings.healthDetailHeading}>
                    <div className='healthMeta'>
                        {result.healthDetail.endpoint && (
                            <span><strong>{strings.healthEndpointLabel}:</strong> <code>{result.healthDetail.endpoint}</code></span>
                        )}
                        {result.healthDetail.checkedUtc && (
                            <span><strong>{strings.healthCheckedLabel}:</strong> {result.healthDetail.checkedUtc}</span>
                        )}
                    </div>
                    <ul className='dependencyList'>
                        {result.healthDetail.services.map((service) => (
                            <li key={service.name}>
                                <span className={`stateDot ${service.state.toLowerCase() === 'up' ? 'good' : 'bad'}`} />
                                <span className='dependencyName'>{service.name}</span>
                                <span className='dependencyState'>{service.state}</span>
                                {!service.essential && <span className='optionalTag'>{strings.optionalDependencyLabel}</span>}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {result.networkPolicy && (
                <Section heading={strings.networkPolicyHeading}>
                    <dl className='definitionList'>
                        {result.networkPolicy.mainSite && (
                            <><dt>{strings.mainSiteLabel}</dt><dd>{result.networkPolicy.mainSite}</dd></>
                        )}
                        {result.networkPolicy.scmSite && (
                            <><dt>{strings.scmSiteLabel}</dt><dd>{result.networkPolicy.scmSite}</dd></>
                        )}
                        {result.networkPolicy.basicPublishingScm !== undefined && (
                            <>
                                <dt>{strings.basicPublishingScmLabel}</dt>
                                <dd>{result.networkPolicy.basicPublishingScm ? strings.enabledLabel : strings.disabledLabel}</dd>
                            </>
                        )}
                        {result.networkPolicy.basicPublishingFtp !== undefined && (
                            <>
                                <dt>{strings.basicPublishingFtpLabel}</dt>
                                <dd>{result.networkPolicy.basicPublishingFtp ? strings.enabledLabel : strings.disabledLabel}</dd>
                            </>
                        )}
                    </dl>
                </Section>
            )}

            {result.healingAttempts.length > 0 && (
                <details className='sectionCard'>
                    <summary><h2>{strings.healingHeading} ({result.healingAttempts.length})</h2></summary>
                    <ol className='healingList'>
                        {result.healingAttempts.map((attempt) => (
                            <li key={attempt.attempt}>
                                <div className='healingAttemptHeader'>
                                    <span className='healingAttemptNumber'>
                                        {strings.healingAttemptLabel} {attempt.attempt}
                                    </span>
                                    {attempt.planLevelChange && (
                                        <span className='planChangeBadge'>{strings.planLevelChangeBadge}</span>
                                    )}
                                </div>
                                {attempt.issue && (
                                    <p><strong>{strings.healingIssueLabel}:</strong> {attempt.issue}</p>
                                )}
                                {attempt.resolution && (
                                    <p><strong>{strings.healingResolutionLabel}:</strong> {attempt.resolution}</p>
                                )}
                            </li>
                        ))}
                    </ol>
                </details>
            )}

            {result.orphanedResourceGroups.length > 0 && (
                <Section heading={strings.orphanedHeading}>
                    <p className='sectionHint'>{strings.orphanedHint}</p>
                    <ul className='bulletList'>
                        {result.orphanedResourceGroups.map((group) => (
                            <li key={group.name}>
                                <code>{group.name}</code>
                                {group.region && ` · ${group.region}`}
                                {group.reason && ` — ${group.reason}`}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {result.resourcesToCleanup.length > 0 && (
                <Section heading={strings.cleanupResourcesHeading}>
                    <p className='sectionHint'>{strings.cleanupResourcesHint}</p>
                    <ul className='cleanupResourceList'>
                        {result.resourcesToCleanup.map((resource) => {
                            const key = resource.id ?? `${resource.type}-${resource.name}`;
                            const badge = resource.classification === 'failed' ? strings.failedBadge : strings.orphanedBadge;
                            return (
                                <li key={key} className='cleanupResourceItem'>
                                    <div className='cleanupResourceHeader'>
                                        <span className={`cleanupBadge ${resource.classification}`}>{badge}</span>
                                        <span className='cleanupResourceName mono'>{resource.name}</span>
                                        <span className='cleanupResourceType'>{resource.type}</span>
                                        {resource.resourceGroup && (
                                            <span className='cleanupResourceGroup'>{resource.resourceGroup}</span>
                                        )}
                                    </div>
                                    {resource.deleteCommand && (
                                        <div className='commandRow'>
                                            <code className='commandText'>{resource.deleteCommand}</code>
                                            <Tooltip
                                                content={copiedKey === key ? strings.copiedLabel : strings.copyButtonAriaLabel}
                                                relationship='label'
                                            >
                                                <Button
                                                    appearance='subtle'
                                                    aria-label={strings.copyButtonAriaLabel}
                                                    icon={<CopyRegular />}
                                                    onClick={() => copyItemText(resource.deleteCommand, key)}
                                                />
                                            </Tooltip>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </Section>
            )}

            {result.cleanupCommand && (
                <Section heading={strings.cleanupHeading}>
                    <p className='sectionHint'>{strings.cleanupHint}</p>
                    <div className='commandRow'>
                        <code className='commandText'>{result.cleanupCommand}</code>
                        <Tooltip content={copied ? strings.copiedLabel : strings.copyButtonAriaLabel} relationship='label'>
                            <Button
                                appearance='subtle'
                                aria-label={strings.copyButtonAriaLabel}
                                icon={<CopyRegular />}
                                onClick={() => copyText(result.cleanupCommand)}
                            />
                        </Tooltip>
                    </div>
                </Section>
            )}
        </div>
    );
};
