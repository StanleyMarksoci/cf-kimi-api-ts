export interface OpenAIErrorBody {
  error: {
    message: string
    type: string
    param: null
    code: string
  }
}

export function errorBody(message: string, type = 'api_error'): OpenAIErrorBody {
  return {
    error: {
      message,
      type,
      param: null,
      code: type,
    },
  }
}

export function jsonError(message: string, type = 'api_error', status = 400): Response {
  return new Response(JSON.stringify(errorBody(message, type)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
