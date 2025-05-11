/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { AggregateQuery } from '@kbn/es-query';
import { EditLookupIndexContentContext } from '@kbn/index-editor';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import { monaco } from '@kbn/monaco';
import React, { useCallback, useEffect, useMemo } from 'react';
import { css } from '@emotion/react';
import { useEuiTheme } from '@elastic/eui';
import { type ESQLSource, parse } from '@kbn/esql-ast';
import type { ESQLEditorDeps, JoinIndexAutocompleteItem } from '../types';

/**
 * Returns a query with appended index name to the join command.
 *
 * @param query Input query
 * @param cursorPosition
 * @param indexName
 *
 * @returns {string} Query with appended index name to the join command
 */
export function appendIndexToJoinCommand(
  query: string,
  cursorPosition: monaco.Position,
  indexName: string
): string {
  const cursorColumn = cursorPosition?.column ?? 1;
  const cursorLine = cursorPosition?.lineNumber ?? 1;

  const lines = query.split('\n');
  const line = lines[cursorLine - 1];

  let beforeCursor = line.slice(0, cursorColumn - 1);
  const afterCursor = line.slice(cursorColumn - 1);

  // Check if the join command already had an index argument.
  // Delete the last word before the cursor
  beforeCursor = beforeCursor.replace(/\S+$/, '');

  const updatedLine = beforeCursor + indexName + afterCursor;
  lines[cursorLine - 1] = updatedLine;

  return lines.join('\n');
}

function isESQLSourceItem(arg: unknown): arg is ESQLSource {
  return typeof arg === 'object' && arg !== null && 'type' in arg && arg.type === 'source';
}

/**
 * Hook to register a custom command and tokens for lookup indices in the ESQL editor.
 * @param editorRef
 * @param editorModel
 * @param getLookupIndices
 * @param query
 * @param onIndexCreated
 */
export const useLookupIndexCommand = (
  editorRef: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor>,
  editorModel: React.MutableRefObject<monaco.editor.ITextModel>,
  getLookupIndices: () => Promise<{ indices: JoinIndexAutocompleteItem[] }>,
  query: AggregateQuery,
  onIndexCreated: (resultQuery: string) => void
) => {
  const { euiTheme } = useEuiTheme();

  const lookupIndexAddBadgeClassName = 'lookupIndexAddBadge';
  const lookupIndexEditBadgeClassName = 'lookupIndexEditBadge';

  const lookupIndexBadgeStyle = css`
    .${lookupIndexAddBadgeClassName} {
      cursor: pointer;
      display: inline-block;
      vertical-align: middle;
      padding-block: 0px;
      padding-inline: 2px;
      max-inline-size: 100%;
      font-size: 0.8571rem;
      line-height: 18px;
      font-weight: 500;
      white-space: nowrap;
      text-decoration: none;
      border: 1px solid ${euiTheme.colors.danger};
      border-radius: 3px;
      text-align: start;
      background-color: ${euiTheme.colors.danger};
    }
    .${lookupIndexEditBadgeClassName} {
      cursor: pointer;
      display: inline-block;
      vertical-align: middle;
      padding-block: 0px;
      padding-inline: 2px;
      max-inline-size: 100%;
      font-size: 0.8571rem;
      line-height: 18px;
      font-weight: 500;
      white-space: nowrap;
      text-decoration: none;
      border: 1px solid ${euiTheme.colors.primary};
      border-radius: 3px;
      text-align: start;
      background-color: ${euiTheme.colors.primary};
    }
  `;

  const kibana = useKibana<ESQLEditorDeps>();
  const { uiActions, docLinks } = kibana.services;

  const inQueryLookupIndices = useMemo<string[]>(() => {
    const indexNames: string[] = [];

    // parse esql query and find lookup indices in the query, traversing the AST
    const { root } = parse(query.esql);
    // find all join commands
    root.commands.forEach((command) => {
      if (command.name === 'join') {
        const indexName = command.args.find<ESQLSource>(isESQLSourceItem);
        if (indexName) {
          indexNames.push(indexName.name);
        }
      }
    });

    return indexNames;
  }, [query.esql]);

  const onUploadComplete = useCallback(
    (results: any) => {
      const cursorPosition = editorRef.current.getPosition();

      if (!cursorPosition) {
        throw new Error('Could not find cursor position in the editor');
      }

      const resultQuery = appendIndexToJoinCommand(query.esql, cursorPosition, results.index);
      onIndexCreated(resultQuery);
    },
    [onIndexCreated, query.esql, editorRef]
  );

  // TODO: Replace with the actual lookup index docs URL once it's available
  // @ts-ignore
  const lookupIndexDocsUrl = docLinks?.links.apis.createIndex;

  monaco.editor.registerCommand('esql.lookup_index.create', async (_, initialIndexName) => {
    await uiActions.getTrigger('EDIT_LOOKUP_INDEX_CONTENT_TRIGGER_ID').exec({
      initialIndexName,
      onUploadComplete,
      onClose: () => {},
      onSave: () => {},
    } as EditLookupIndexContentContext);
  });

  const addLookupIndicesDecorator = useCallback(() => {
    // we need to remove the previous decorations first
    const lineCount = editorModel.current?.getLineCount() || 1;
    for (let i = 1; i <= lineCount; i++) {
      const decorations = editorRef.current?.getLineDecorations(i) ?? [];
      editorRef?.current?.removeDecorations(decorations.map((d) => d.id));
    }

    getLookupIndices().then(({ indices: existingIndices }) => {
      // TODO extract aliases as well
      const lookupIndices: string[] = inQueryLookupIndices;

      // TODO parse the query and find the lookup indices in the query that do not exist

      for (let i = 0; i < lookupIndices.length; i++) {
        const lookupIndex = lookupIndices[i];

        const isExistingIndex = existingIndices.some((index) => index.name === lookupIndex);

        const matches =
          editorModel.current?.findMatches(lookupIndex, true, false, true, null, true) || [];

        matches.forEach((match) => {
          const range = new monaco.Range(
            match.range.startLineNumber,
            match.range.startColumn,
            match.range.endLineNumber,
            match.range.endColumn
          );

          editorRef?.current?.createDecorationsCollection([
            {
              range,
              options: {
                isWholeLine: false,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                inlineClassName: isExistingIndex
                  ? lookupIndexEditBadgeClassName
                  : lookupIndexAddBadgeClassName,
              },
            },
          ]);
        });
      }
    });
  }, [editorModel, getLookupIndices, editorRef, inQueryLookupIndices]);

  useEffect(
    function updateOnQueryChange() {
      addLookupIndicesDecorator();
    },
    [query.esql, addLookupIndicesDecorator]
  );

  return { addLookupIndicesDecorator, lookupIndexBadgeStyle };
};
