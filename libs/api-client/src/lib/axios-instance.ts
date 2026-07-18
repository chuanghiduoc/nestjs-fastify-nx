import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

// Access window via globalThis so this file type-checks without DOM lib
// in non-browser tsconfig contexts (Node.js codegen, SSR). At runtime in a
// browser, globalThis === window so the cast is correct.
const _globalThis = globalThis as Record<string, unknown>;
const _isBrowser = typeof _globalThis['window'] !== 'undefined';

// Origin only — never a path. Generated operations already carry the full server path, and axios
// concatenates, so `/api/v1` here would send `/api/v1/api/v1/users/me`. Empty in the browser
// because same-origin needs no prefix.
const BASE_URL = _isBrowser
  ? ((_globalThis['__API_URL__'] as string | undefined) ?? '')
  : (process.env['API_BASE_URL'] ?? 'http://localhost:3000');

export const axiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

export interface CancellablePromise<T> extends Promise<T> {
  cancel: () => void;
}

export const customAxiosInstance = <T>(config: AxiosRequestConfig): CancellablePromise<T> => {
  const controller = new AbortController();
  const promise = axiosInstance({ ...config, signal: controller.signal }).then(
    ({ data }) => data as T,
  ) as CancellablePromise<T>;
  promise.cancel = () => controller.abort('Query was cancelled');
  return promise;
};

export default customAxiosInstance;
