import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

const BASE_URL =
  typeof window !== 'undefined'
    ? ((window as Window & { __API_URL__?: string }).__API_URL__ ?? '/api/v1')
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
