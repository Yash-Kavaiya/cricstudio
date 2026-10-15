import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { env: { STREAM_KEY_SECRET: 'test-secret', DATA_DIR: 'data-test' } } });
