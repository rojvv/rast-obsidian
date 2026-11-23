import { after } from 'node:test';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
after(() => window.close());
