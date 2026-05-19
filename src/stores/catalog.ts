export interface KimiCatalogModel {
  id: string
  name?: string
  [key: string]: unknown
}

export interface KimiModelCatalog {
  models: KimiCatalogModel[]
  updatedAt?: number
  [key: string]: unknown
}

interface CachedCatalog extends KimiModelCatalog {
  updatedAt: number
}

const CATALOG_TTL_SECONDS = 300

function catalogKey(baseUrl: string): string {
  return `catalog:${baseUrl}`
}

export async function getCachedCatalog(
  kv: KVNamespace,
  baseUrl: string
): Promise<KimiModelCatalog | null> {
  const data = await kv.get(catalogKey(baseUrl), 'json')
  if (!data || typeof data !== 'object') return null

  const cached = data as Partial<CachedCatalog>
  if (!Array.isArray(cached.models) || typeof cached.updatedAt !== 'number') return null
  if (Date.now() - cached.updatedAt > CATALOG_TTL_SECONDS * 1000) return null

  return cached as CachedCatalog
}

export async function setCachedCatalog(
  kv: KVNamespace,
  baseUrl: string,
  catalog: KimiModelCatalog
): Promise<void> {
  const cached: CachedCatalog = {
    ...catalog,
    models: catalog.models,
    updatedAt: Date.now(),
  }

  await kv.put(catalogKey(baseUrl), JSON.stringify(cached), {
    expirationTtl: CATALOG_TTL_SECONDS,
  })
}
