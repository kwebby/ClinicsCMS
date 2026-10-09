/* Author: ramanpal singh | URL: https://kwebby.com */
import { defineConfig,configDefaults } from 'vitest/config';
export default defineConfig({test:{exclude:[...configDefaults.exclude,'tests/web/**/*.spec.ts'],testTimeout:15000,hookTimeout:30000}});
