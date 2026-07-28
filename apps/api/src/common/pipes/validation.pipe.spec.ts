import { IsString } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ProblemDetailsValidationPipe } from './validation.pipe';

class CredentialsDto {
  @IsString()
  apiKey!: string;
}

describe('ProblemDetailsValidationPipe', () => {
  it('never echoes an invalid client value in the error response', async () => {
    const pipe = new ProblemDetailsValidationPipe();

    try {
      await pipe.transform(
        { apiKey: 'sk-test-secret', unexpectedOtp: '123456' },
        { type: 'body', metatype: CredentialsDto },
      );
      throw new Error('Expected validation to fail');
    } catch (error) {
      const response = (
        error as { getResponse: () => { errors: Array<Record<string, unknown>> } }
      ).getResponse();
      const serialized = JSON.stringify(response);

      expect(response.errors.length).toBeGreaterThan(0);
      expect(response.errors.every((item) => !('received' in item))).toBe(true);
      expect(serialized).not.toContain('sk-test-secret');
      expect(serialized).not.toContain('123456');
    }
  });
});
