/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue } from '@microsoft/vscode-azext-utils';
import * as jsonc from 'jsonc-parser';
import { Diagnostic, Position, Range } from "vscode";
import { localize } from "../../utils/localize";

export function getTagDiagnostics(text: string): Diagnostic[] {
    const visitor: TagVisitor = new TagVisitor();
    jsonc.visit(text, visitor);
    return visitor.diagnostics;
}

/**
 * Tag docs: https://docs.microsoft.com/azure/azure-resource-manager/management/tag-resources#limitations
 *
 * Note: 'this' is not properly bound in 'jsonc-parser'. As a workaround, I'm using the following notation for methods:
 *     public helloWorld = () => { };
 * instead of this:
 *     public helloWorld(): void { }
 */
class TagVisitor implements jsonc.JSONVisitor {
    public diagnostics: Diagnostic[] = [];
    private readonly _objectOpenBracketPositions: Position[] = [];
    private readonly _arrayOpenBracketPositions: Position[] = [];
    private _tagCount: number = 0;
    private readonly _existingTags: string[] = [];

    /**
     * Invoked when an open brace is encountered and an object is started. The offset and length represent the location of the open brace.
     */
    public onObjectBegin = (_offset: number, _length: number, startLine: number, startCharacter: number) => {
        this._objectOpenBracketPositions.push(new Position(startLine, startCharacter));
    }

    /**
     * Invoked when a closing brace is encountered and an object is completed. The offset and length represent the location of the closing brace.
     */
    public onObjectEnd = (_offset: number, _length: number, closeBracketLine: number, closeBracketChar: number) => {
        const openBracketPosition: Position = nonNullValue(this._objectOpenBracketPositions.pop());
        if (this._objectOpenBracketPositions.length === 1) { // only show the error for an outer-most invalid object
            const range: Range = new Range(openBracketPosition, new Position(closeBracketLine, closeBracketChar + 1));
            this.addTagValueTypeError(range, 'object');
        }
    }

    /**
     * Invoked when an open bracket is encountered. The offset and length represent the location of the open bracket.
     */
    public onArrayBegin = (_offset: number, _length: number, startLine: number, startCharacter: number) => {
        this._arrayOpenBracketPositions.push(new Position(startLine, startCharacter));
    }

    /**
     * Invoked when a closing bracket is encountered. The offset and length represent the location of the closing bracket.
     */
    public onArrayEnd = (_offset: number, _length: number, closeBracketLine: number, closeBracketChar: number) => {
        const openBracketPosition: Position = nonNullValue(this._arrayOpenBracketPositions.pop());
        if (this._arrayOpenBracketPositions.length === 0) { // only show the error for an outer-most array
            const range: Range = new Range(openBracketPosition, new Position(closeBracketLine, closeBracketChar + 1));
            const actualType: string = 'array';
            if (this._objectOpenBracketPositions.length === 0) {
                this.addTagsTypeError(range, actualType);
            } else if (this._objectOpenBracketPositions.length === 1) {
                this.addTagValueTypeError(range, actualType);
            }
        }
    }

    /**
     * Invoked when a property is encountered. The offset and length represent the location of the property name.
     */
    public onObjectProperty = (property: string, _offset: number, length: number, startLine: number, startCharacter: number) => {
        if (this._objectOpenBracketPositions.length === 1) {
            this._tagCount += 1;

            const range: Range = new Range(startLine, startCharacter, startLine, startCharacter + length);
            const max: number = 512;
            if (property.length > max) {
                this.addError(range, localize('tagNameTooLong', 'Tag name must be {0} characters or less.', max));
            }

            if (/^\s*$/.test(property)) {
                const error: string = localize('tagNameEmpty', 'Tag name cannot be empty.');
                this.addError(range, error);
            }

            const invalidChars: string[] = ['<', '>', '%', '&', '\\', '?', '/'];
            const matchingChars: string[] = invalidChars.filter(c => property.includes(c));
            if (matchingChars.length > 0) {
                const error: string = localize('tagNameInvalidChars', 'Tag name cannot contain the following characters: {0}', invalidChars.join(', '));
                this.addError(range, error);
            }

            if (this._existingTags.includes(property.toLowerCase())) {
                const error: string = localize('tagNameAlreadyUsed', 'Tag name is already used. Tag names are case-insensitive.');
                this.addError(range, error);
            } else {
                this._existingTags.push(property.toLowerCase());
            }

            const maxTags: number = 50;
            if (this._tagCount > maxTags) {
                this.addError(range, localize('tooManyTags', 'Only {0} tags are allowed.', maxTags));
            }
        }
    }

    /**
     * Invoked when a literal value is encountered. The offset and length represent the location of the literal value.
     */
    public onLiteralValue = (value: unknown, _offset: number, length: number, startLine: number, startChar: number) => {
        const range: Range = new Range(startLine, startChar, startLine, startChar + length);
        const actualType: string = typeof value;
        if (this._objectOpenBracketPositions.length === 0) {
            this.addTagsTypeError(range, actualType);
        } else if (typeof value !== 'string') {
            this.addTagValueTypeError(range, actualType);
        } else {
            const max: number = 256;
            if (value.length > max) {
                this.addError(range, localize('tagValueTooLong', 'Tag value must be {0} characters or less.', max));
            }
        }
    }

    private addTagsTypeError(range: Range, actualType: string): void {
        this.addError(range, localize('tagsTypeError', 'Tags must be an object of key/value pairs instead of "{0}".', actualType));
    }

    private addTagValueTypeError(range: Range, actualType: string): void {
        this.addError(range, localize('tagTypeError', 'Tag value must be of type "string" instead of "{0}".', actualType));
    }

    private addError(range: Range, error: string): void {
        const diagnostic: Diagnostic = new Diagnostic(range, error);
        diagnostic.source = 'Azure';
        this.diagnostics.push(diagnostic);
    }
}
