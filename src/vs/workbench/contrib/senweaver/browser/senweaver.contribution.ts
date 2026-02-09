/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// register Context services
// import './contextGatheringService.js'
// import './contextUserChangesService.js'

// settings pane
import './senweaverSettingsPane.js'

// custom API service
import '../common/customApiService.js'

// register css
import './media/senweaver.css'

// update (frontend part, also see platform/)
import './senweaverUpdateActions.js'

// online config loading
import './senweaverOnlineConfigContribution.js'

// changelog display
import './senweaverChangelogEditor.js'
import './senweaverChangelogContribution.js'
import './senweaverChangelogActions.js'

import './convertToLLMMessageWorkbenchContrib.js'

// tools
import './toolsService.js'
import './terminalToolService.js'

// register Thread History
import './chatThreadService.js'

// ping
import './metricsPollService.js'

// helper services
import './helperServices/consistentItemService.js'

// register selection helper
import './senweaverSelectionHelperWidget.js'

// register edit prediction widget
import './editPredictionService.js'
import './editPredictionWidget.js'

// register EditAgent and SubagentTool services
import './editAgentService.js'
import './subagentToolService.js'

// register built-in browser
import './senweaverBrowserEditor.js'

// register design canvas editor
import './senweaverDesignerPreviewEditor.js'

// register custom API editor
import './senweaverCustomApiEditor.js'

// register document editor
import './senweaverDocumentEditor.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './senweaverOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register remote collaboration service
import './remoteCollaborationService.js'

// register source control management
import './senweaverSCMService.js'

// register file snapshot service
import './fileSnapshotService.js'
import './fileSnapshotContentProvider.js'
import './fileSnapshotContribution.js'
import './fileSnapshotDecorationProvider.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// senweaverSettings
import '../common/senweaverSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/senweaverUpdateService.js'

// model service
import '../common/senweaverModelService.js'

// changelog service
import '../common/senweaverChangelogService.js'
