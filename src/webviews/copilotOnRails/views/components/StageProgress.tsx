/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from 'react';
import '../styles/stageProgress.scss';

interface StageProgressProps {
    currentStage: 0 | 1 | 2;
}

const stages = ['Project Scaffolding', 'Local Development', 'Deployment'] as const;

export const StageProgress = ({ currentStage }: StageProgressProps): JSX.Element => {
    const stageSegmentPercent = 100 / stages.length;
    const currentStageOffsetPercent = (currentStage / stages.length) * 100;

    return (
        <div className='stageProgressTop'>
            <div className='stageProgress' role='group' aria-label='Project stages progress'>
                <div className='stageProgressTrack'>
                    <div
                        className='stageProgressFill'
                        style={{
                            width: `${stageSegmentPercent}%`,
                            left: `${currentStageOffsetPercent}%`,
                        }}
                    />
                </div>

                <div className='stageProgressSteps'>
                    {stages.map((label, idx) => {
                        const state = idx < currentStage ? 'completed' : idx === currentStage ? 'current' : 'upcoming';
                        return (
                            <div key={label} className={`stageProgressStep ${state}`}>
                                <span className='stageProgressMarker' aria-hidden='true'>{idx + 1}</span>
                                <span className='stageProgressLabel'>{label}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
