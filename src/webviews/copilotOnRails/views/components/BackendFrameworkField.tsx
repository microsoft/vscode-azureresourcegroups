/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { isAzureFunctionsFramework } from '../utils/parseScaffoldPlanMarkdown';

interface BackendFrameworkFieldProps {
    value: string;
    disabled?: boolean;
    edited?: boolean;
    onChange: (value: string) => void;
}

export const BackendFrameworkField = ({ value, disabled, edited, onChange }: BackendFrameworkFieldProps): JSX.Element => {
    const errorId = useId();
    const [custom, setCustom] = useState(() => !isAzureFunctionsFramework(value));
    const lastValue = useRef(value);
    const missing = !value.trim();

    useEffect(() => {
        if (value !== lastValue.current) {
            setCustom(!isAzureFunctionsFramework(value));
        }
        lastValue.current = value;
    }, [value]);

    const updateValue = (nextValue: string): void => {
        // Keep the custom input open while typing, even when its text matches the standard option.
        lastValue.current = nextValue;
        onChange(nextValue);
    };

    return (
        <div className='backendFrameworkField'>
            <select
                className={`cellDropdown ${edited ? 'edited' : ''}`}
                aria-label='Backend framework'
                value={custom ? 'custom' : 'functions'}
                disabled={disabled}
                onChange={event => {
                    const nextCustom = event.target.value === 'custom';
                    setCustom(nextCustom);
                    updateValue(nextCustom ? '' : 'Azure Functions');
                }}
            >
                <option value='functions'>Azure Functions</option>
                <option value='custom'>Custom framework</option>
            </select>
            {custom && (
                <>
                    <input
                        className='customFrameworkInput'
                        aria-label='Custom backend framework'
                        aria-invalid={missing}
                        aria-describedby={missing ? errorId : undefined}
                        placeholder='Enter a framework name'
                        value={value}
                        disabled={disabled}
                        required
                        onChange={event => updateValue(event.target.value)}
                    />
                    {missing && <span className='frameworkInputError' id={errorId} role='alert'>Enter a custom framework to continue.</span>}
                </>
            )}
        </div>
    );
};
