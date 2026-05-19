import { KimiAPIError } from './protocol'
import {
  buildKimiHeaders,
  classifyUpstreamStatus,
  getSharedTransport,
  loadOrCreateClientIdentity,
  processSessionId,
  retryAfterSeconds,
} from './transport'

const KIMI_AVAILABLE_MODELS_PATH = '/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels'
const MODEL_CATALOG_CACHE_SECONDS = 300

export interface KimiModelSpec {
  id: string
  displayName: string
  scenario: string
  thinking: boolean
  supportsWebSearch: boolean
  baseModelId: string
  forceWebSearch: boolean
  kimiPlusId: string
  agentMode: string
  description: string
  inputPlaceholder: string
}

export interface KimiModelCatalog {
  models: KimiModelSpec[]
  defaultModelId: string
}

type CatalogCache = { baseUrl: string; expiresAt: number; catalog: KimiModelCatalog }
let catalogCache: CatalogCache | undefined

export function parseModelCatalog(data: Record<string, any>): KimiModelCatalog {
  const rawModels = Array.isArray(data.availableModels)
    ? data.availableModels
    : Array.isArray(data.available_models)
      ? data.available_models
      : []

  const models = dedupeModels(rawModels.filter((m) => m && typeof m === 'object').map((m) => modelSpec(m)))
  const defaultScenario = (data.defaultScenario || data.default_scenario || {}) as Record<string, unknown>

  return {
    models: withSearchAliases(models),
    defaultModelId: defaultModelId(models, defaultScenario),
  }
}

export async function fetchModelCatalog(baseUrl: string, token?: string): Promise<KimiModelCatalog> {
  const resolvedBaseUrl = baseUrl.replace(/\/+$/, '')
  const identity = loadOrCreateClientIdentity()
  const headers = buildKimiHeaders({
    baseUrl: resolvedBaseUrl,
    token,
    deviceId: identity.deviceId,
    sessionId: processSessionId(),
    extra: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })

  const transport = getSharedTransport({ baseUrl: resolvedBaseUrl, timeout: 15 })
  const response = await transport.request('POST', KIMI_AVAILABLE_MODELS_PATH, {
    headers,
    body: JSON.stringify({}),
  })

  if (response.status !== 200) {
    throw new KimiAPIError(`failed to fetch Kimi model catalog: ${response.status}`, {
      upstreamStatusCode: response.status,
      upstreamErrorType: classifyUpstreamStatus(response.status),
      retryAfter: retryAfterSeconds(response.headers),
    })
  }

  const data = (await response.json()) as Record<string, any>
  return parseModelCatalog(data)
}

export async function getModelCatalog(
  kv: KVNamespace,
  baseUrl: string,
  forceRefresh = false,
  token?: string,
): Promise<KimiModelCatalog> {
  const resolvedBaseUrl = baseUrl.replace(/\/+$/, '')
  const now = Date.now() / 1000

  if (!forceRefresh && catalogCache && catalogCache.baseUrl === resolvedBaseUrl && now < catalogCache.expiresAt) {
    return catalogCache.catalog
  }

  if (!forceRefresh) {
    const cached = await kv.get(`kimi:model_catalog:${resolvedBaseUrl}`, 'json')
    if (cached && typeof cached === 'object') {
      const parsed = cached as KimiModelCatalog
      catalogCache = {
        baseUrl: resolvedBaseUrl,
        expiresAt: now + MODEL_CATALOG_CACHE_SECONDS,
        catalog: parsed,
      }
      return parsed
    }
  }

  const catalog = await fetchModelCatalog(resolvedBaseUrl, token)
  catalogCache = {
    baseUrl: resolvedBaseUrl,
    expiresAt: now + MODEL_CATALOG_CACHE_SECONDS,
    catalog,
  }
  await kv.put(`kimi:model_catalog:${resolvedBaseUrl}`, JSON.stringify(catalog), {
    expirationTtl: MODEL_CATALOG_CACHE_SECONDS,
  })
  return catalog
}

export function clearModelCatalogCache(): void {
  catalogCache = undefined
}

function rawValue(source: Record<string, any>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in source) return source[name]
  }
  return undefined
}

function modelVersionSlug(displayName: string, scenario: string): string {
  const match = /\bK\s*([0-9]+(?:\.[0-9]+)?)\b/i.exec(displayName)
  if (match) return `k${match[1]}`
  if (scenario === 'SCENARIO_K2') return 'k2'
  if (scenario === 'SCENARIO_K2D5') return 'k2.6'
  return scenario.toLowerCase().replace('scenario_', '').replace(/_/g, '-')
}

function modelSuffix(options: {
  scenario: string
  displayName: string
  thinking: boolean
  kimiPlusId: string
  agentMode: string
}): string {
  const normalizedName = options.displayName.toLowerCase()
  if (options.agentMode === 'TYPE_ULTRA' || normalizedName.includes('swarm')) return 'agent-swarm'
  if (options.scenario === 'SCENARIO_OK_COMPUTER' || options.kimiPlusId || normalizedName.includes('agent')) {
    return 'agent'
  }
  if (options.thinking) return 'thinking'
  return ''
}

function modelId(rawModel: Record<string, any>): string {
  const scenario = String(rawValue(rawModel, 'scenario') || '')
  const displayName = String(rawValue(rawModel, 'displayName', 'display_name') || scenario)
  const thinking = Boolean(rawValue(rawModel, 'thinking'))
  const kimiPlusId = String(rawValue(rawModel, 'kimiPlusId', 'kimi_plus_id') || '')
  const agentMode = String(rawValue(rawModel, 'agentMode', 'agent_mode') || '')
  const version = modelVersionSlug(displayName, scenario)
  const suffix = modelSuffix({ scenario, displayName, thinking, kimiPlusId, agentMode })
  return `kimi-${version}${suffix ? `-${suffix}` : ''}`
}

function modelSpec(rawModel: Record<string, any>): KimiModelSpec {
  const scenario = String(rawValue(rawModel, 'scenario') || '')
  const displayName = String(rawValue(rawModel, 'displayName', 'display_name') || scenario)
  const id = modelId(rawModel)
  const supportsWebSearch = scenario === 'SCENARIO_K2D5'
  return {
    id,
    displayName,
    scenario,
    thinking: Boolean(rawValue(rawModel, 'thinking')),
    supportsWebSearch,
    baseModelId: id,
    forceWebSearch: false,
    kimiPlusId: String(rawValue(rawModel, 'kimiPlusId', 'kimi_plus_id') || ''),
    agentMode: String(rawValue(rawModel, 'agentMode', 'agent_mode') || ''),
    description: String(rawValue(rawModel, 'description') || ''),
    inputPlaceholder: String(rawValue(rawModel, 'inputPlaceholder', 'input_placeholder') || ''),
  }
}

function dedupeModels(models: KimiModelSpec[]): KimiModelSpec[] {
  const deduped = new Map<string, KimiModelSpec>()
  for (const model of models) {
    if (model.id && !deduped.has(model.id)) deduped.set(model.id, model)
  }
  return [...deduped.values()]
}

function searchAliasId(modelIdText: string): string {
  return `${modelIdText}-search`
}

function searchAlias(model: KimiModelSpec): KimiModelSpec {
  return {
    ...model,
    id: searchAliasId(model.id),
    displayName: `${model.displayName} Search`,
    supportsWebSearch: true,
    baseModelId: model.id,
    forceWebSearch: true,
    description: model.description ? `${model.description} with web search` : 'Web search enabled',
  }
}

function withSearchAliases(models: KimiModelSpec[]): KimiModelSpec[] {
  const result = [...models]
  const ids = new Set(result.map((m) => m.id))

  for (const model of models) {
    if (!model.supportsWebSearch || model.forceWebSearch || model.id.endsWith('-search')) continue
    const aliasId = searchAliasId(model.id)
    if (ids.has(aliasId)) continue
    result.push(searchAlias(model))
    ids.add(aliasId)
  }

  return result
}

function defaultModelId(models: KimiModelSpec[], defaultScenario: Record<string, unknown>): string {
  const scenario = String(defaultScenario.scenario || '')
  const hasThinking = Object.prototype.hasOwnProperty.call(defaultScenario, 'thinking')
  const thinking = Boolean(defaultScenario.thinking)

  for (const model of models) {
    if (model.scenario !== scenario) continue
    if (hasThinking && model.thinking !== thinking) continue
    return model.id
  }

  if (models.length > 0) return models[0].id
  throw new KimiAPIError('Kimi model catalog is empty')
}
