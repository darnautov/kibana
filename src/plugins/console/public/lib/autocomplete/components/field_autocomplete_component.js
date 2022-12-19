/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import _ from 'lodash';
import { getAutocompleteInfo, ENTITIES } from '../../../services';
import { ListComponent } from './list_component';

async function FieldGenerator(context) {
  const arr = await getAutocompleteInfo().getEntityProvider(ENTITIES.FIELDS, context);
  return _.map(arr, function (field) {
    return { name: field.name, meta: field.type };
  });
}

export class FieldAutocompleteComponent extends ListComponent {
  constructor(name, parent, multiValued) {
    console.log('__FieldAutocompleteComponent____');

    super(name, FieldGenerator, parent, multiValued);
  }
  validateTokens(tokens) {
    if (!this.multiValued && tokens.length > 1) {
      return false;
    }

    return !_.find(tokens, function (token) {
      return token.match(/[^\w.?*]/);
    });
  }

  getDefaultTermMeta() {
    return 'field';
  }

  getContextKey() {
    return 'fields';
  }
}
