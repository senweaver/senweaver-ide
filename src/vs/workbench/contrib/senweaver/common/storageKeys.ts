/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// past values:
// 'senweaver.settingsServiceStorage'
// 'senweaver.settingsServiceStorageI' // 1.0.2

// 1.0.3
export const SENWEAVER_SETTINGS_STORAGE_KEY = 'senweaver.settingsServiceStorageII'


// past values:
// 'senweaver.chatThreadStorage'
// 'senweaver.chatThreadStorageI' // 1.0.2

// 1.0.3
export const THREAD_STORAGE_KEY = 'senweaver.chatThreadStorageII'

// Sharded storage keys (each thread stored separately for performance)
export const THREAD_INDEX_KEY = 'senweaver.threadIndex' // stores array of thread IDs
export const THREAD_SHARD_PREFIX = 'senweaver.thread.' // + threadId for each thread



export const OPT_OUT_KEY = 'senweaver.app.optOutAll'
