/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SenWeaver. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
    context: __dirname,
    entry: {
        extension: './src/extension.ts'
    }
});

