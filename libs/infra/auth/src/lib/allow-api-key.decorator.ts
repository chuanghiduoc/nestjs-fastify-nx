import { SetMetadata } from '@nestjs/common';

export const ALLOW_API_KEY_KEY = 'allow_api_key';

/**
 * Opts a route into machine-to-machine access. Without it an API key is rejected even when its
 * scopes would satisfy the route: a key has no user behind it, so any handler reading
 * `@CurrentUser()` would be acting on a session that does not exist.
 */
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY_KEY, true);
