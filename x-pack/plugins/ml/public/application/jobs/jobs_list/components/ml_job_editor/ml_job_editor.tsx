/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { FC, useMemo } from 'react';
import { CodeEditor, CodeEditorProps } from '@kbn/kibana-react-plugin/public';
import { XJsonLang } from '@kbn/monaco';
import { useMlApiContext } from '../../../../contexts/kibana';
import {
  EuiCodeEditorProps,
  expandLiteralStrings,
  XJsonMode,
} from '../../../../../../shared_imports';

export const ML_EDITOR_MODE = { TEXT: 'text', JSON: 'json', XJSON: new XJsonMode() };

interface MlJobEditorProps {
  value: string;
  height?: string;
  width?: string;
  mode?: typeof ML_EDITOR_MODE[keyof typeof ML_EDITOR_MODE];
  readOnly?: boolean;
  syntaxChecking?: boolean;
  theme?: string;
  onChange?: EuiCodeEditorProps['onChange'];
}

export const MLJobEditor: FC<MlJobEditorProps> = ({
  value,
  height = '500px',
  width = '100%',
  mode = ML_EDITOR_MODE.JSON,
  readOnly = false,
  syntaxChecking = true,
  theme = 'textmate',
  onChange = () => {},
}) => {
  const { autocomplete } = useMlApiContext();

  if (mode === ML_EDITOR_MODE.XJSON) {
    try {
      value = expandLiteralStrings(value);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  const provideCompletionItems = useMemo<
    Exclude<CodeEditorProps['suggestionProvider'], undefined>['provideCompletionItems']
  >(() => {
    return async (model, position, context, token) => {
      const input = model.getValue();

      try {
        const res = await autocomplete.suggest({
          method: 'PUT',
          url: '/_ml/anomaly_detectors/{job_id}',
          line: position.lineNumber,
          column: position.column - 1,
          jsonInput: input,
        });

        const suggestions = (res ?? []).map((v) => {
          return {
            label: v,
            kind: 3,
            insertText: v,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column + v.length,
            },
          };
        });

        return {
          suggestions,
        };
      } catch (e) {}
    };
  }, []);

  return (
    <CodeEditor
      languageId={XJsonLang.ID}
      value={value}
      width={width}
      height={height}
      onChange={(input, event) => {
        onChange(input);
      }}
      suggestionProvider={{
        provideCompletionItems,
      }}
    />
  );
};
