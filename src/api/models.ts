import type { KimiModelCatalog, KimiModelSpec } from '../kimi/model-catalog'

export class ModelResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelResolutionError'
  }
}

export interface ModelFeatures {
  model: string
  modelSpec: KimiModelSpec
  requestModel: string
  enableThinking: boolean
  enableWebSearch: boolean
}

export function modelToDict(model: KimiModelSpec, created: number) {
  return {
    id: model.id,
    object: 'model',
    created,
    owned_by: 'moonshot',
    display_name: model.displayName,
    description: model.description,
    scenario: model.scenario,
    thinking: model.thinking,
    kimi_plus_id: model.kimiPlusId,
    agent_mode: model.agentMode,
  }
}

function requestedModel(payload: Record<string, unknown>, catalog: KimiModelCatalog, defaultModel: string): string {
  const model = typeof payload.model === 'string' ? payload.model.trim().toLowerCase() : ''
  if (model) return model
  if (defaultModel.trim()) return defaultModel.trim().toLowerCase()
  return catalog.defaultModelId
}

function explicitThinking(payload: Record<string, unknown>): boolean | null {
  if ('enable_thinking' in payload && payload.enable_thinking != null) return Boolean(payload.enable_thinking)
  if ('reasoning' in payload && payload.reasoning != null) return Boolean(payload.reasoning)
  return null
}

function toolsEnableWebSearch(payload: Record<string, unknown>): boolean {
  if (!Array.isArray(payload.tools)) return false
  for (const tool of payload.tools) {
    if (!tool || typeof tool !== 'object') continue
    const type = typeof (tool as Record<string, unknown>).type === 'string' ? String((tool as Record<string, unknown>).type).trim().toLowerCase() : ''
    if (type === 'web_search' || type.startsWith('web_search_preview')) return true
  }
  return false
}

function extractWebSearch(payload: Record<string, unknown>): boolean {
  if (payload.enable_web_search || payload.web_search || payload.search) return true
  if ('web_search_options' in payload && payload.web_search_options !== null && payload.web_search_options !== false) return true
  return toolsEnableWebSearch(payload)
}

export function resolveModel(
  payload: Record<string, unknown>,
  catalog: KimiModelCatalog,
  defaultModel: string,
): ModelFeatures {
  const requestModel = requestedModel(payload, catalog, defaultModel)
  const modelSpec = catalog.models.find((m) => m.id === requestModel)
  if (!modelSpec) throw new ModelResolutionError(`Model \`${requestModel}\` is not available`)

  const thinking = explicitThinking(payload)
  if (thinking !== null && thinking !== modelSpec.thinking) {
    throw new ModelResolutionError('`enable_thinking`/`reasoning` conflicts with the selected model')
  }

  const enableWebSearch = modelSpec.forceWebSearch || extractWebSearch(payload)
  if (enableWebSearch && !modelSpec.supportsWebSearch) {
    throw new ModelResolutionError(
      `Model \`${modelSpec.id}\` does not support web search; use \`kimi-k2.6\` or \`kimi-k2.6-thinking\` instead`,
    )
  }

  return {
    model: modelSpec.baseModelId,
    requestModel: modelSpec.id,
    modelSpec,
    enableThinking: modelSpec.thinking,
    enableWebSearch,
  }
}
