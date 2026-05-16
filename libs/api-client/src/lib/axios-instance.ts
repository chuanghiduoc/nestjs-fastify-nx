import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

// Access window via globalThis so this file type-checks without DOM lib
// in non-browser tsconfig contexts (Node.js codegen, SSR). At runtime in a
// browser, globalThis === window so the cast is correct.
const _globalThis = globalThis as Record<string, unknown>;
const _isBrowser = typeof _globalThis['window'] !== 'undefined';

const BASE_URL = _isBrowser
  ? ((_globalThis['__API_URL__'] as string | undefined) ?? '/api/v1')
  : (process.env['API_BASE_URL'] ?? 'http://localhost:3000/api/v1');

export const axiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

export interface CancellablePromise<T> extends Promise<T> {
  cancel: () => void;
}

export const customAxiosInstance = <T>(config: AxiosRequestConfig): CancellablePromise<T> => {
  const source = axios.CancelToken.source(); // TODO: migrate to AbortController when axios drops CancelToken
  const promise = axiosInstance({ ...config, cancelToken: source.token }).then(
    ({ data }) => data as T,
  ) as CancellablePromise<T>;
  promise.cancel = () => source.cancel('Query was cancelled');
  return promise;
};

export default customAxiosInstance;
