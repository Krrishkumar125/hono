/**
 * @module
 * Method Override Middleware for Hono.
 */

import type { Context, ExecutionContext } from '../../context'
import type { Hono } from '../../hono'
import type { MiddlewareHandler } from '../../types'
import { parseBody } from '../../utils/body'

type MethodOverrideOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: Hono<any, any, any>
} & (
  | {
      // Default is 'form' and the value is `_method`
      form?: string
      header?: never
      query?: never
    }
  | {
      form?: never
      header: string
      query?: never
    }
  | {
      form?: never
      header?: never
      query: string
    }
)

const DEFAULT_METHOD_FORM_NAME = '_method'

// A GET or HEAD Request cannot have a body, so the overridden request must be built without one
const isBodylessMethod = (method: string) => /^(?:GET|HEAD)$/i.test(method)

const withoutBodyHeaders = (headers: Headers) => {
  const newHeaders = new Headers(headers)
  newHeaders.delete('content-type')
  newHeaders.delete('content-length')
  return newHeaders
}

/**
 * Method Override Middleware for Hono.
 *
 * @see {@link https://hono.dev/docs/middleware/builtin/method-override}
 *
 * @param {MethodOverrideOptions} options - The options for the method override middleware.
 * @param {Hono} options.app - The instance of Hono is used in your application.
 * @param {string} [options.form=_method] - Form key with a value containing the method name.
 * @param {string} [options.header] - Header name with a value containing the method name.
 * @param {string} [options.query] - Query parameter key with a value containing the method name.
 * @returns {MiddlewareHandler} The middleware handler function.
 *
 * @example
 * ```ts
 * const app = new Hono()
 *
 * // If no options are specified, the value of `_method` in the form,
 * // e.g. DELETE, is used as the method.
 * app.use('/posts', methodOverride({ app }))
 *
 * app.delete('/posts', (c) => {
 *   // ....
 * })
 * ```
 */
export const methodOverride = (options: MethodOverrideOptions): MiddlewareHandler =>
  async function methodOverride(c, next) {
    if (c.req.method === 'GET') {
      return await next()
    }

    const app = options.app
    // Method override by form
    if (!(options.header || options.query)) {
      const contentType = c.req.header('content-type')
      const methodFormName = options.form || DEFAULT_METHOD_FORM_NAME
      const clonedRequest = c.req.raw.clone()
      const newRequest = clonedRequest.clone()
      // Content-Type is `multipart/form-data`
      if (contentType?.startsWith('multipart/form-data')) {
        const form = await clonedRequest.formData()
        const method = form.get(methodFormName)
        if (method) {
          const newHeaders = withoutBodyHeaders(clonedRequest.headers)
          let body: FormData | undefined
          if (!isBodylessMethod(method as string)) {
            body = await newRequest.formData()
            body.delete(methodFormName)
          }
          const request = new Request(c.req.url, {
            body,
            headers: newHeaders,
            method: method as string,
          })
          return app.fetch(request, c.env, getExecutionCtx(c))
        }
      }
      // Content-Type is `application/x-www-form-urlencoded`
      if (contentType?.startsWith('application/x-www-form-urlencoded')) {
        const params = await parseBody<Record<string, string>>(clonedRequest)
        const method = params[methodFormName]
        if (method) {
          delete params[methodFormName]
          const request = isBodylessMethod(method)
            ? new Request(c.req.url, {
                headers: withoutBodyHeaders(newRequest.headers),
                method,
              })
            : new Request(newRequest, {
                body: new URLSearchParams(params),
                method,
              })
          return app.fetch(request, c.env, getExecutionCtx(c))
        }
      }
    }
    // Method override by header
    else if (options.header) {
      const headerName = options.header
      const method = c.req.header(headerName)
      if (method) {
        if (isBodylessMethod(method)) {
          const newHeaders = withoutBodyHeaders(c.req.raw.headers)
          newHeaders.delete(headerName)
          const request = new Request(c.req.url, {
            headers: newHeaders,
            method,
          })
          return app.fetch(request, c.env, getExecutionCtx(c))
        }
        const newHeaders = new Headers(c.req.raw.headers)
        newHeaders.delete(headerName)
        const request = new Request(c.req.raw, {
          headers: newHeaders,
          method,
        })
        return app.fetch(request, c.env, getExecutionCtx(c))
      }
    }
    // Method override by query
    else if (options.query) {
      const queryName = options.query
      const method = c.req.query(queryName)
      if (method) {
        const url = new URL(c.req.url)
        url.searchParams.delete(queryName)
        const bodyless = isBodylessMethod(method)
        const body = bodyless ? null : c.req.raw.body
        const requestInit: RequestInit & { duplex?: 'half' } = {
          body,
          headers: bodyless ? withoutBodyHeaders(c.req.raw.headers) : c.req.raw.headers,
          method,
          duplex: body ? 'half' : undefined,
        }
        const request = new Request(url.toString(), requestInit)
        return app.fetch(request, c.env, getExecutionCtx(c))
      }
    }
    await next()
  }

const getExecutionCtx = (c: Context) => {
  let executionCtx: ExecutionContext | undefined
  try {
    executionCtx = c.executionCtx
  } catch {
    // Do nothing
  }
  return executionCtx
}
