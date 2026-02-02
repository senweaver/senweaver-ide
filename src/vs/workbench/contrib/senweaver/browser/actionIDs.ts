// Normally you'd want to put these exports in the files that register them, but if you do that you'll get an import order error if you import them in certain cases.
// (importing them runs the whole file to get the ID, causing an import error). I guess it's best practice to separate out IDs, pretty annoying...

export const SENWEAVER_CTRL_L_ACTION_ID = 'senweaver.ctrlLAction'

export const SENWEAVER_CTRL_K_ACTION_ID = 'senweaver.ctrlKAction'

export const SENWEAVER_ACCEPT_DIFF_ACTION_ID = 'senweaver.acceptDiff'

export const SENWEAVER_REJECT_DIFF_ACTION_ID = 'senweaver.rejectDiff'

export const SENWEAVER_GOTO_NEXT_DIFF_ACTION_ID = 'senweaver.goToNextDiff'

export const SENWEAVER_GOTO_PREV_DIFF_ACTION_ID = 'senweaver.goToPrevDiff'

export const SENWEAVER_GOTO_NEXT_URI_ACTION_ID = 'senweaver.goToNextUri'

export const SENWEAVER_GOTO_PREV_URI_ACTION_ID = 'senweaver.goToPrevUri'

export const SENWEAVER_ACCEPT_FILE_ACTION_ID = 'senweaver.acceptFile'

export const SENWEAVER_REJECT_FILE_ACTION_ID = 'senweaver.rejectFile'

export const SENWEAVER_ACCEPT_ALL_DIFFS_ACTION_ID = 'senweaver.acceptAllDiffs'

export const SENWEAVER_REJECT_ALL_DIFFS_ACTION_ID = 'senweaver.rejectAllDiffs'
