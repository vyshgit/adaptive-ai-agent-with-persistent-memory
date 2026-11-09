import test from 'node:test'
import assert from 'node:assert/strict'
import { safeMarkdownUrl } from '../src/agent/markdownSafety.ts'

test('model Markdown links allow explicit web URLs only, without credentials or executable schemes', () => {
  assert.equal(safeMarkdownUrl('https://docs.wal.app/walrus-memory/'), 'https://docs.wal.app/walrus-memory/')
  assert.equal(safeMarkdownUrl('http://localhost:3000/guide'), 'http://localhost:3000/guide')
  assert.equal(safeMarkdownUrl('HTTPS://example.com/docs?q=hello#api'), 'https://example.com/docs?q=hello#api')
  for (const value of ['', 'javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)', 'file:///etc/passwd', 'mailto:hello@example.com', '//example.com/path', '/api/agent/auth/logout',
    'src/example.ts', '#section', 'https://user:password@example.com', 'https://token@example.com', 'https://']) {
    assert.equal(safeMarkdownUrl(value), '', value)
  }
})
